# MOBIEER — Sistema de Gestão de Almoxarifado

Sistema empresarial completo de gestão de almoxarifado para a MOBIEER, com versão Web e Desktop.

## Stack

| Camada     | Tecnologia                                              |
| ---------- | ------------------------------------------------------- |
| Frontend   | React, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, React Router, React Hook Form, Zod |
| Backend    | Node.js, TypeScript, Express, Prisma ORM                |
| Banco      | PostgreSQL                                              |
| Desktop    | Electron (Windows)                                      |

## Arquitetura

```
React + TypeScript
        ↓
      REST API
        ↓
Node.js + Express
        ↓
      Prisma
        ↓
    PostgreSQL
```

Para desktop, o mesmo frontend React e a API são empacotados pelo Electron:

```
React
  ↓
Electron
  ↓
Aplicativo Windows/macOS/Linux
```

## Estrutura

```
project/
  frontend/          → Aplicação React (Web + Desktop)
    src/
      components/
      pages/
      layouts/
      hooks/
      services/
      types/
      utils/
  backend/           → API REST (Node + Express + Prisma)
    src/
      modules/
      controllers/
      services/
      middlewares/
      routes/
      utils/
    prisma/
      schema.prisma
      seed.ts
  desktop/
    main.js          → Processo principal do Electron
    copy-files.mjs   → Preparação dos artefatos para empacotamento
  docker-compose.yml → PostgreSQL local
```

## Requisitos

- Node.js ≥ 20
- Docker Desktop (para o PostgreSQL)
- PostgreSQL disponível também durante o uso da versão desktop

## Como rodar

### 1. Subir o banco

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run seed
npm run dev
```

API disponível em `http://localhost:3333`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App disponível em `http://localhost:5173`

### Desktop (Electron)

```bash
npm run build:frontend
npm run build:backend
cd desktop
npm install
npm run dev
```

## Credenciais de desenvolvimento (seed)

O seed cria uma conta por perfil (`admin@`, `gestor@`, `almoxarife@`, `solicitante@`, `visual@`, `rh@` e `financeiro@mobieer.com.br`).
Nenhuma senha fica no repositório: defina `SEED_PASSWORD` no `.env` (mínimo de 10 caracteres) antes de rodar o seed,
ou deixe em branco para o seed gerar uma senha e mostrá-la no terminal naquela execução.
Nunca rode o seed no banco de produção.

## Módulos

- Dashboard com KPIs dinâmicos e gráfico de movimentações
- Produtos, categorias e fornecedores (CRUD completo)
- Entrada e saída de materiais com atualização de estoque
- Movimentações e alertas automáticos de estoque mínimo
- Inventário com contagem física e divergências
- Requisições com fluxo de aprovação
- Relatórios com exportação PDF / Excel / CSV
- Usuários, perfis e permissões (RBAC)
- Busca global com autocomplete
- Notificações e auditoria
