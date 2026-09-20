# Sincronizador MOBIEER ← Promob

O Promob não tem API: os projetos saem dele por **arquivo**. A exportação é feita
pelo plugin/extensão de exportação do próprio Promob, que grava o **XML do
orçamento / plano de corte** (ou um PDF) numa pasta do computador.

Este sincronizador fica rodando nesse computador, observa essa pasta e envia cada
arquivo novo para o projeto certo no MOBIEER — sem ninguém precisar subir o
arquivo pela tela. O XML chega já lido: ambientes, itens e **valores**, que
alimentam o contrato automático e o plano de corte.

> **Importante:** isto não substitui o plugin de exportação do Promob. Um plugin
> que rode *dentro* do Promob (botão no menu dele) só pode ser desenvolvido com o
> SDK da Promob/Cyncly. O sincronizador funciona com qualquer plugin ou
> exportação que salve o arquivo numa pasta.

## 1. Gerar o token no MOBIEER

1. Entre como administrador → **Configurações → Integrações**.
2. **Novo token**, nome "Computador do Promob", permissão *Enviar arquivos exportados do Promob*.
3. Copie o token (começa com `mbx_`). Ele só aparece uma vez.

## 2. Configurar no computador do Promob

1. Copie a pasta `promob-sync` para o computador (ex.: `C:\MOBIEER\promob-sync`).
2. Copie `promob-sync.config.example.json` para `promob-sync.config.json` e preencha:

   | Campo | O que é |
   |---|---|
   | `apiUrl` | Endereço do backend do MOBIEER (sem barra no final) |
   | `token` | O token `mbx_...` gerado no passo 1 |
   | `watchFolder` | Pasta onde o Promob salva as exportações |
   | `recursive` | `true` para olhar subpastas também |
   | `intervalSeconds` | De quanto em quanto tempo verificar (padrão 30) |

3. Abra o PowerShell na pasta e teste:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\promob-sync.ps1 -Test
   ```

4. Para iniciar junto com o Windows:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\instalar-inicializacao.ps1
   ```

## 3. Como nomear os arquivos

O projeto é reconhecido pelo **código no começo do nome do arquivo**:

- `364-1 Cozinha.xml` → projeto **364-1**
- `364-1_orcamento_final.xml` → projeto **364-1**
- `Cozinha 364-1.xml` → **não reconhece** (o código tem que vir primeiro)

Arquivo sem código reconhecido aparece no log como aviso e não é reenviado sem
parar. Renomeie e ele é enviado no próximo ciclo.

## Log e reenvio

- Tudo fica em `promob-sync.log`, na mesma pasta.
- `promob-sync.state.json` guarda o que já foi enviado. Se um arquivo for
  alterado (tamanho ou data mudam), ele é enviado de novo como nova versão.
- O servidor também ignora o mesmo arquivo reenviado em 30 dias.
- Para remover da inicialização: `.\instalar-inicializacao.ps1 -Remover`.
