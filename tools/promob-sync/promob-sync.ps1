<#
.SYNOPSIS
  Sincronizador MOBIEER <- Promob.

.DESCRIPTION
  Observa a pasta onde o plugin/exportação do Promob salva os arquivos (XML de
  orçamento/plano de corte, ou PDF) e envia cada arquivo novo para o projeto
  correspondente no MOBIEER.

  O projeto é identificado pelo CÓDIGO no começo do nome do arquivo:
    "364-1 Cozinha.xml"  ->  projeto 364-1

  Compatível com Windows PowerShell 5.1 (já vem no Windows 10/11).

.EXAMPLE
  # Testar a conexão
  .\promob-sync.ps1 -Test

  # Enviar o que houver de novo e sair
  .\promob-sync.ps1 -Once

  # Ficar observando a pasta (padrão)
  .\promob-sync.ps1
#>
[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot "promob-sync.config.json"),
  [switch]$Once,
  [switch]$Test
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------- configuração
if (-not (Test-Path $ConfigPath)) {
  Write-Host "Arquivo de configuração não encontrado: $ConfigPath" -ForegroundColor Red
  Write-Host "Copie promob-sync.config.example.json para promob-sync.config.json e preencha."
  exit 1
}
$config = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

$ApiUrl = ($config.apiUrl -replace '/+$', '')
$Token = $config.token
$Folder = $config.watchFolder
$Extensions = @(".xml", ".pdf")
if ($config.extensions) { $Extensions = @($config.extensions | ForEach-Object { $_.ToLower() }) }
$IntervalSeconds = 30
if ($config.intervalSeconds) { $IntervalSeconds = [int]$config.intervalSeconds }
# espera o arquivo "assentar" (o Promob pode ainda estar gravando)
$SettleSeconds = 10

if (-not $ApiUrl -or -not $Token -or -not $Folder) {
  Write-Host "Preencha apiUrl, token e watchFolder em $ConfigPath" -ForegroundColor Red
  exit 1
}
if (-not $Token.StartsWith("mbx_")) {
  Write-Host "O token deve começar com mbx_ (gere em Configurações > Integrações no MOBIEER)." -ForegroundColor Red
  exit 1
}

$StatePath = Join-Path $PSScriptRoot "promob-sync.state.json"
$LogPath = Join-Path $PSScriptRoot "promob-sync.log"

function Write-Log([string]$Message, [string]$Level = "INFO") {
  $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  $color = switch ($Level) { "ERRO" { "Red" } "AVISO" { "Yellow" } "OK" { "Green" } default { "Gray" } }
  Write-Host $line -ForegroundColor $color
}

# ---------------------------------------------------------------- estado local
# Guarda caminho + tamanho + data de alteração do que já foi enviado.
function Get-State {
  if (Test-Path $StatePath) {
    try {
      $raw = Get-Content $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
      $h = @{}
      foreach ($p in $raw.PSObject.Properties) { $h[$p.Name] = $p.Value }
      return $h
    } catch { Write-Log "Estado corrompido, recomeçando: $($_.Exception.Message)" "AVISO" }
  }
  return @{}
}
function Save-State($state) {
  ($state | ConvertTo-Json -Depth 3) | Set-Content -Path $StatePath -Encoding UTF8
}
function Get-FileKey($file) {
  return "{0}|{1}|{2}" -f $file.FullName.ToLower(), $file.Length, $file.LastWriteTimeUtc.Ticks
}

# ---------------------------------------------------------------- HTTP
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(120)
$client.DefaultRequestHeaders.Add("X-Mobieer-Token", $Token)

function Read-Json($response) {
  $body = $response.Content.ReadAsStringAsync().Result
  try { return $body | ConvertFrom-Json } catch { return @{ message = $body } }
}

function Test-Connection {
  $resp = $client.GetAsync("$ApiUrl/api/integrations/promob/ping").Result
  $json = Read-Json $resp
  if ($resp.IsSuccessStatusCode) {
    Write-Log "Conectado a $($json.data.organization) (token: $($json.data.token))" "OK"
    return $true
  }
  Write-Log "Falha na conexão ($([int]$resp.StatusCode)): $($json.message)" "ERRO"
  return $false
}

function Send-File($file) {
  $content = New-Object System.Net.Http.MultipartFormDataContent
  $stream = [System.IO.File]::OpenRead($file.FullName)
  try {
    $fileContent = New-Object System.Net.Http.StreamContent($stream)
    $mime = if ($file.Extension.ToLower() -eq ".pdf") { "application/pdf" } else { "application/xml" }
    $fileContent.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue($mime)
    $content.Add($fileContent, "file", $file.Name)
    $resp = $client.PostAsync("$ApiUrl/api/integrations/promob/imports", $content).Result
    return @{ ok = $resp.IsSuccessStatusCode; status = [int]$resp.StatusCode; json = (Read-Json $resp) }
  } finally {
    $stream.Dispose()
    $content.Dispose()
  }
}

# ---------------------------------------------------------------- ciclo
function Invoke-Sync {
  if (-not (Test-Path $Folder)) {
    Write-Log "Pasta não encontrada: $Folder" "ERRO"
    return
  }
  $state = Get-State
  $now = Get-Date
  $files = Get-ChildItem -Path $Folder -File -Recurse:([bool]$config.recursive) |
    Where-Object { $Extensions -contains $_.Extension.ToLower() } |
    Where-Object { ($now - $_.LastWriteTime).TotalSeconds -ge $SettleSeconds } |
    Sort-Object LastWriteTime

  foreach ($file in $files) {
    $key = Get-FileKey $file
    if ($state.ContainsKey($key)) { continue }

    try {
      $r = Send-File $file
      if ($r.ok) {
        $d = $r.json.data
        if ($d.duplicate) {
          Write-Log "Já existia no projeto $($d.project.code): $($file.Name)" "INFO"
        } else {
          Write-Log "Enviado para $($d.project.code) — $($d.project.name): $($file.Name) ($($r.json.message))" "OK"
        }
        $state[$key] = @{ sentAt = (Get-Date -Format "o"); project = $d.project.code; importId = $d.importId }
        Save-State $state
      } elseif ($r.status -eq 404) {
        # arquivo sem código de projeto reconhecido: não fica tentando sem parar
        Write-Log "Projeto não identificado para '$($file.Name)'. Renomeie começando pelo código do projeto (ex.: 364-1 Cozinha.xml)." "AVISO"
        $state[$key] = @{ skippedAt = (Get-Date -Format "o"); reason = "projeto não encontrado" }
        Save-State $state
      } elseif ($r.status -eq 401 -or $r.status -eq 403) {
        Write-Log "Token recusado ($($r.status)): $($r.json.message). Verifique o token em Configurações > Integrações." "ERRO"
        return
      } else {
        # erro temporário (rede/servidor): tenta de novo no próximo ciclo
        Write-Log "Falha ao enviar '$($file.Name)' ($($r.status)): $($r.json.message)" "ERRO"
      }
    } catch {
      Write-Log "Erro ao enviar '$($file.Name)': $($_.Exception.Message)" "ERRO"
    }
  }
}

# ---------------------------------------------------------------- execução
if ($Test) {
  if (Test-Connection) { exit 0 } else { exit 1 }
}

if (-not (Test-Connection)) {
  if ($Once) { exit 1 }
  Write-Log "Vou continuar tentando a cada $IntervalSeconds segundos." "AVISO"
}

Write-Log "Observando $Folder ($($Extensions -join ', '))"
do {
  Invoke-Sync
  if ($Once) { break }
  Start-Sleep -Seconds $IntervalSeconds
} while ($true)
