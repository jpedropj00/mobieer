# Medição e projeto técnico

## Medições
Menu **Medições**, ou a aba **Medição** dentro do projeto. Cada visita de medição tem data, horário e responsável.

- O cliente vê a visita no **portal** e pode **confirmar o horário** ou **sugerir outras datas**.
- Na visita é possível anexar fotos e usar a **prancheta de desenho**: desenhar à mão, tirar uma foto na hora ou escolher da galeria e desenhar por cima, e anotar fotos já anexadas.

## Pasta técnica
Fica na aba **Projeto técnico** do projeto, no cartão **Pasta técnica**. O sistema monta o PDF do projeto executivo com:
- **capa** com cliente, projeto, ambientes e índice de folhas;
- **folha de especificação**, preenchida sozinha com os acabamentos do orçamento do projeto (caixaria, portas e frentes, puxador, complemento, modelo);
- **pranchas**: as imagens exportadas do Promob (planta baixa, vistas, perspectiva). Cada imagem recebe o carimbo da loja com cliente, ambiente e logotipo, mais o título e a escala.

Como montar:
1. No cartão Pasta técnica, informe o ambiente e clique em **Enviar pranchas do Promob** (imagens PNG ou JPG, ou o PDF exportado).
2. Ajuste o título, o ambiente, a escala e a observação de cada prancha; use as setas para mudar a ordem.
3. Clique em **Gerar PDF** para conferir.
4. Clique em **Salvar nos documentos** para guardar a pasta nos documentos do projeto.

PDF exportado do Promob entra página por página. Se a página já vem com carimbo, desmarque a opção Carimbo daquela prancha.

## Desenhar por medidas (vista cotada sem o Promob)
No cartão **Pasta técnica** há o botão **Desenhar por medidas**. Você digita as medidas em milímetros e o sistema desenha a vista frontal do móvel com as cotas, e coloca como uma prancha da pasta:
1. Informe o ambiente, o título da prancha (ex.: VISTA A INTERNA) e a escala.
2. Escreva a descrição do móvel (sai na chamada, junto com L x A x P) e informe largura, altura, profundidade, roda-teto e rodapé.
3. Monte as colunas, da esquerda para a direita. Cada coluna pode ter **prateleiras**, **portas**, **gavetas** ou ser um **vão livre**. Largura em branco fica com o que sobrar.
4. Em prateleiras e gavetas, digite as alturas de cima para baixo, separadas por ponto e vírgula. Em branco, o sistema divide por igual. Se faltar a última, ela fica com o resto.
5. Clique em **Salvar e ver o desenho**.

Tipos de coluna: **Prateleiras**, **Portas**, **Gavetas**, **Sapateira**, **Maleiro**, **Vão livre** e **Outros (escrever)** — em Outros você digita o nome (ex.: Cabideiro) e ele sai escrito dentro da coluna.

Medidas gerais do móvel:
- **Roda-teto**: a faixa de acabamento em cima.
- **Rodapé**: a faixa de baixo.
- **Fechamento / vista esquerda e direita**: a tira de acabamento ao lado do móvel. As colunas ocupam a largura que sobra.
- **Espessura da chapa**: 15,5 mm por padrão. As prateleiras saem desenhadas com essa espessura e ela entra na cota (vão, 15,5, vão…). As alturas que você digita são os vãos livres; a espessura o sistema desconta sozinho.

O botão **Salvar e ver o desenho** abre a prancha como ela sai na pasta, com o carimbo, o título e a escala.

A folha sai no modelo da loja: a vista cotada, o título (ex.: VISTA B), a escala e o carimbo com cliente, ambiente e logotipo. Dois recursos opcionais:
- **Imagem 3D ao lado**: envie uma ou duas imagens 3D (PNG ou JPG) e elas entram à direita da vista, na mesma folha. Sem imagem, a vista ocupa a folha inteira. O sistema não desenha o 3D, só posiciona a imagem enviada.
- **Chamada por coluna**: da segunda coluna em diante, dá para escrever um texto próprio (ex.: "Portas de giro em alumínio prata L 1180 x A 2349 x P 360"). Ele sai ao lado do móvel, com a linha apontando para a coluna.

Perspectiva ou planta sozinha em uma folha continua sendo enviada em **Enviar pranchas do Promob**.

Se as alturas não fecharem com o vão interno (altura menos topo e rodapé), o sistema desenha mesmo assim e avisa a diferença. Para mudar as medidas depois, use o botão de lápis e régua na prancha. O desenho é só a vista frontal em 2D: perspectiva e planta continuam vindo do Promob.

## Imagem 3D gerada por IA (em preparação)
Na tela **Desenhar por medidas**, cada espaço de imagem 3D tem o botão **Gerar com IA**. A IA recebe a vista cotada já salva e as medidas digitadas, e devolve a perspectiva do móvel (fechado ou aberto), que entra ao lado da vista na mesma folha. Ela não pode mudar medidas, quantidade nem posição de portas, prateleiras e gavetas.

O botão só funciona quando a chave da IA de imagem (GEMINI_API_KEY) está configurada no servidor; sem ela, ele fica desativado e a imagem 3D continua sendo enviada pelo botão de escolher imagem. Para usar, salve o desenho primeiro e depois abra as medidas de novo (o lápis com régua na prancha).

## Desenhar e escrever na prancha
Cada prancha da pasta técnica tem o botão **Anotar** (o lápis). Ele abre a prancha em tela grande para você desenhar à mão e escrever por cima: marcar um ponto, riscar, escrever "maleiro", avisar de uma tomada. Há três ferramentas (**Desenhar**, **Escrever** e **Borracha**), cinco cores e três espessuras, além de desfazer e limpar. Em **Escrever**, clique no ponto da prancha, digite e aperte Enter.

As anotações ficam numa camada separada: a borracha nunca apaga o desenho, e dá para reabrir e continuar depois. Elas saem no PDF da pasta técnica no mesmo lugar. Funciona em imagem, em PDF e nas pranchas desenhadas por medidas; só não vale para página de PDF que entra sem o carimbo da loja.

## Aprovação do projeto técnico
Na mesma aba fica a aprovação: a equipe publica o projeto técnico para o cliente, que aprova ou pede ajustes pelo portal. Cada rodada fica registrada com data, quem decidiu e o comentário do cliente. Com a aprovação, o projeto pode ser liberado para produção.

## Render com IA
Aba **Render** do projeto. Transforma a imagem do ambiente exportada do Promob em um render realista com os acabamentos do projeto, sem mudar os móveis.
1. Clique em **Escolher imagem do Promob** e selecione a imagem (PNG, JPG ou WEBP).
2. Informe o ambiente. Os acabamentos do orçamento desse ambiente já vêm preenchidos; ajuste o texto se precisar.
3. Escolha a iluminação: luz natural do dia, noite ou luz neutra de estúdio.
4. Clique em **Gerar render**. Pode levar até 1 minuto.

Cada render aparece ao lado da imagem original. Em **Ajustar este render** você descreve uma mudança (por exemplo, trocar o puxador) e a IA gera uma nova versão a partir da anterior. **Baixar** salva a imagem e **Salvar nos documentos** guarda o render nos documentos do projeto.

O render é uma imagem ilustrativa: medidas e detalhes de execução continuam valendo pela pasta técnica. Há um limite de 20 renders por hora por pessoa.

### Render pelo Mobieer AI
O render também pode ser pedido no chat do Mobieer AI: clique no botão de imagem ao lado do campo de texto, escolha a imagem do Promob, escreva os acabamentos (opcional), escolha a iluminação e envie. O render aparece na conversa, com os botões **Baixar** e **Ajustar este render**. O render feito pelo chat não fica guardado no projeto; para guardar, use a aba Render do projeto.
