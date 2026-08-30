# Gestium — arquitetura incremental

## Diagnóstico (2026-08-20)

O repositório é um monorepo com frontend React/Vite, API Express, Prisma/PostgreSQL e empacotamento Electron. A autenticação usa JWT e o RBAC é persistido em `Role`, `Permission` e `RolePermission`; as rotas críticas já validam permissões no backend. Estoque é representado por `Product.stock`, `Product.reservedStock`, saldos por almoxarifado, movimentos imutáveis e reservas.

A requisição legada era uma solicitação simples de produtos (`PENDING → IN_REVIEW → APPROVED → SEPARATION → CONCLUDED`) e efetuava baixa automática ao concluir. Ela não representava medidas, acabamento, execução individual, conferência ou histórico de domínio. Também não existe hoje `Organization`: usuários, produtos, movimentos, relatórios e busca compartilham um namespace global.

## Decisões desta etapa

- Evoluir `Requisition` e `RequisitionItem` preservando IDs e relacionamentos existentes.
- Separar ciclo da requisição, ciclo de cada peça, conferência, anexos e histórico.
- Vincular reservas a requisição e peça. Reserva altera apenas o saldo reservado; conclusão não baixa estoque automaticamente.
- Toda mudança operacional relevante grava `RequisitionHistory` e `AuditLog` na mesma transação.
- Centralizar transições e permissões no serviço de domínio; a interface apenas apresenta ações autorizadas.
- Expor lista operacional de corte como projeção da mesma entidade, evitando duplicar dados em uma tabela de Kanban.
- Representar cliente e projeto inicialmente por referências opcionais. Quando esses módulos forem criados, adicionar FKs opcionais e migrar os textos existentes.

## Entidades implementadas

- `Requisition`: informações gerais, prioridade, prazo, responsáveis, datas operacionais e resultado da conferência.
- `RequisitionItem`: descrição, material, produto opcional, medidas, quantidade, unidade, acabamento, observação e andamento.
- `RequisitionHistory`: ator, ação, valores anterior/novo, observação e data.
- `RequisitionAttachment`: metadados e URL de armazenamento.
- `StockReservation`: vínculo opcional com requisição e peça.

## API implementada

- `GET/POST /api/requisitions`
- `GET/PATCH /api/requisitions/:id`
- `GET /api/requisitions/indicators`
- `GET /api/requisitions/cutting-board`
- `PATCH /api/requisitions/:id/status`
- `PATCH /api/requisitions/:id/items/:itemId/status`
- `POST /api/requisitions/:id/reservations`
- `POST /api/requisitions/:id/inspection`

## Multiempresa: estratégia segura

Adicionar `organizationId` somente às requisições não produziria isolamento: busca global, estoque, relatórios, notificações e movimentos ainda poderiam expor dados. A implantação deve ocorrer em uma migration própria:

1. Criar `Organization` e uma organização padrão, sem tornar FKs obrigatórias ainda.
2. Adicionar `organizationId` anulável a usuários, funções, produtos, categorias, fornecedores, almoxarifados, movimentos, reservas, inventários, requisições, notificações, auditoria e configurações.
3. Preencher todos os registros existentes com a organização padrão e validar órfãos.
4. Trocar unicidades globais por compostas (`organizationId + email/code/name`) quando aplicável.
5. Incluir `organizationId` no JWT e revalidá-lo no middleware de autenticação.
6. Introduzir um contexto Prisma por requisição que injete o escopo nas leituras e escritas; negar operações sem contexto, em vez de usar filtros opcionais.
7. Criar testes negativos de isolamento para cada módulo e só então tornar as FKs obrigatórias.
8. Migrar uma organização piloto, auditar e expandir gradualmente.

Até essa fase ser concluída, o produto deve ser operado como instalação de uma única empresa. Isso evita anunciar uma garantia de isolamento que a base legada ainda não consegue cumprir.

## Próximas integrações preparadas

- `projectReference` e `clientName` podem receber `projectId`/`customerId` sem remover os textos históricos.
- Materiais insuficientes são identificáveis por item e podem originar `PurchaseRequestItem` futuramente.
- Datas e responsáveis permitem gerar tarefas e eventos sem acoplar o módulo de requisições a agenda/Kanban.
- Histórico e endpoints estruturados são a base de leitura do Gestium AI; ações críticas continuam exigindo confirmação e permissão explícita.
