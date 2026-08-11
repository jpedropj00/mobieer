# MOBIEER — Sistema de Gestão de Almoxarifado

Sistema empresarial completo de gestão de almoxarifado para a MOBIEER, com versão Web e Desktop.

## Stack

| Camada     | Tecnologia                                              |
| ---------- | ------------------------------------------------------- |
| Frontend   | React, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, React Router, React Hook Form, Zod |
| Backend    | Node.js, TypeScript, Express, Prisma ORM                |
| Banco      | PostgreSQL                                              |
| Desktop    | Tauri (Windows / macOS / Linux)                         |

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

Para desktop, o mesmo frontend React é empacotado pelo Tauri:

```
React
  ↓
Tauri
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
    src-tauri/       → Configuração Tauri
  docker-compose.yml → PostgreSQL local
```

## Requisitos

- Node.js ≥ 20
- Docker Desktop (para o PostgreSQL)
- Rust (apenas para build desktop com Tauri)

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

### Desktop (Tauri)

```bash
cd desktop
npm install
npm run tauri dev
```

## Credenciais de desenvolvimento (seed)

| Perfil        | Email                    | Senha      |
| ------------- | ------------------------ | ---------- |
| Administrador | admin@mobieer.com.br     | admin123   |
| Gestor        | gestor@mobieer.com.br    | gestor123  |
| Almoxarife    | almoxarife@mobieer.com.br | almox123  |
| Solicitante   | solicitante@mobieer.com.br | sol123   |
| Visualizador  | visual@mobieer.com.br    | visual123  |

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
