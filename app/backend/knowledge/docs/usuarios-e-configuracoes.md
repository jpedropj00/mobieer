# Usuários, permissões e configurações

## Usuários
Menu **Usuários** (grupo Administração), para quem tem essa permissão. Ali se cadastra cada pessoa da equipe com nome, e-mail, perfil e setor. O perfil define as permissões, e as permissões definem quais menus e ações aparecem.

## Senha
- Na tela de entrada, **Esqueci minha senha** envia um link de redefinição para o e-mail.
- No primeiro acesso, ou quando um administrador redefine a senha, o sistema pede a troca antes de continuar.

## Não vejo um menu
Os menus dependem do perfil. Se uma tela descrita na documentação não aparece para você, peça a um administrador para rever as permissões do seu perfil em Usuários.

## Auditoria
Menu **Auditoria**: registro de quem fez o quê e quando.

## Configurações
Menu **Configurações**: preferências da conta e ajustes do sistema.

## Relatórios
Menu **Relatórios**: relatórios do sistema, conforme a permissão de cada um.

## Notificações
O sino no topo da tela reúne os avisos: lembretes comerciais, a Semana da Mobieer, tarefas e outros. Clicar num aviso leva à tela correspondente.

## Verificação em duas etapas
Menu **Configurações**, aba **Minha conta**, cartão **Verificação em duas etapas**. Além da senha, o sistema pede um código de 6 dígitos gerado no celular por um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou Authy).
1. Clique em **Ativar verificação em duas etapas**.
2. No aplicativo do celular, adicione uma conta e leia o QR Code (ou digite a chave mostrada).
3. Digite o código de 6 dígitos e clique em **Confirmar e ativar**.
4. Guarde os **códigos de recuperação** que aparecem: cada um vale uma vez e substitui o código do celular. Eles não são mostrados de novo.

Depois de ativar, o login pede a senha e, em seguida, o código. É opcional para todos e recomendada para administrador, gestor e financeiro, que veem um lembrete no topo das telas.

Perdeu o celular e não tem código de recuperação: peça a um administrador. Em **Usuários**, o botão de escudo cortado desliga a verificação em duas etapas da pessoa, que volta a entrar só com a senha e pode configurar de novo.

## Avisos de erro do sistema
Quem tem a permissão de auditoria recebe no sino um aviso quando o sistema dá um erro interno ou quando uma tela quebra no navegador de alguém, com a rota e um código de rastreio. O mesmo erro avisa no máximo uma vez a cada 15 minutos.

## Mais de um cargo por usuário
No cadastro do usuário (menu **Usuários**), além do **Perfil** principal, o campo **Cargos adicionais** permite marcar outros perfis para a mesma pessoa. Ela passa a ter as permissões de todos os cargos marcados, somadas. Exemplo: perfil principal Financeiro, com os adicionais Recursos Humanos e Comercial.
- Na lista de usuários, os cargos adicionais aparecem ao lado do perfil principal, com um "+".
- Os avisos enviados por permissão (financeiro, RH, auditoria) chegam para a pessoa por qualquer um dos cargos.
- Se a loja usa restrição de horário por perfil, a pessoa entra quando pelo menos um dos cargos dela está liberado.
- Para tirar um cargo, edite o usuário e desmarque.

