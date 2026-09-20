<#
.SYNOPSIS
  Faz o sincronizador do Promob iniciar sozinho quando o usuário entra no Windows.

.DESCRIPTION
  Cria uma tarefa agendada "MOBIEER Promob Sync" que roda promob-sync.ps1 em
  segundo plano no logon. Para remover: .\instalar-inicializacao.ps1 -Remover
#>
param([switch]$Remover)

$ErrorActionPreference = "Stop"
$TaskName = "MOBIEER Promob Sync"

if ($Remover) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarefa removida." -ForegroundColor Green
  exit 0
}

$script = Join-Path $PSScriptRoot "promob-sync.ps1"
if (-not (Test-Path (Join-Path $PSScriptRoot "promob-sync.config.json"))) {
  Write-Host "Crie o promob-sync.config.json antes (copie do .example e preencha)." -ForegroundColor Red
  exit 1
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Test
if ($LASTEXITCODE -ne 0) {
  Write-Host "O teste de conexão falhou. Corrija a configuração antes de instalar." -ForegroundColor Red
  exit 1
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Pronto: o sincronizador vai iniciar junto com o Windows e já está rodando." -ForegroundColor Green
Write-Host "Acompanhe em: $(Join-Path $PSScriptRoot 'promob-sync.log')"
