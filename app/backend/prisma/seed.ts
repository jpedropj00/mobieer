import fs from "fs";
import path from "path";
import { PrismaClient, Role, Unit, MovementType } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { storage, buildStorageKey } from "../src/lib/storage";

const prisma = new PrismaClient();

const PERMISSIONS = [
  { code: "dashboard.read", label: "Ver dashboard", module: "Dashboard" },
  { code: "products.read", label: "Ver produtos", module: "Produtos" },
  { code: "products.create", label: "Criar produtos", module: "Produtos" },
  { code: "products.update", label: "Editar produtos", module: "Produtos" },
  { code: "products.delete", label: "Remover produtos", module: "Produtos" },
  { code: "categories.read", label: "Ver categorias", module: "Categorias" },
  { code: "categories.create", label: "Criar categorias", module: "Categorias" },
  { code: "categories.update", label: "Editar categorias", module: "Categorias" },
  { code: "categories.delete", label: "Remover categorias", module: "Categorias" },
  { code: "suppliers.read", label: "Ver fornecedores", module: "Fornecedores" },
  { code: "suppliers.create", label: "Criar fornecedores", module: "Fornecedores" },
  { code: "suppliers.update", label: "Editar fornecedores", module: "Fornecedores" },
  { code: "suppliers.delete", label: "Remover fornecedores", module: "Fornecedores" },
  { code: "warehouses.read", label: "Ver almoxarifados", module: "Almoxarifado" },
  { code: "warehouses.manage", label: "Gerenciar almoxarifados", module: "Almoxarifado" },
  { code: "stock.read", label: "Ver estoque", module: "Estoque" },
  { code: "stock.movements", label: "Ver movimentações", module: "Estoque" },
  { code: "stock.entry", label: "Registrar entrada", module: "Estoque" },
  { code: "stock.exit", label: "Registrar saída", module: "Estoque" },
  { code: "stock.adjust", label: "Ajustar estoque", module: "Estoque" },
  { code: "stock.negative", label: "Permitir estoque negativo", module: "Estoque" },
  { code: "stock.transfer", label: "Transferir estoque", module: "Estoque" },
  { code: "stock.reserve", label: "Gerenciar reservas", module: "Estoque" },
  { code: "stock.occurrence", label: "Registrar devoluções, perdas e avarias", module: "Estoque" },
  { code: "stock.scanner", label: "Usar scanner", module: "Estoque" },
  { code: "inventory.read", label: "Ver inventários", module: "Inventário" },
  { code: "inventory.create", label: "Criar inventários", module: "Inventário" },
  { code: "inventory.update", label: "Realizar contagem", module: "Inventário" },
  { code: "inventory.adjust", label: "Ajustar divergências", module: "Inventário" },
  { code: "requisitions.read", label: "Ver requisições", module: "Requisições" },
  { code: "requisitions.read.all", label: "Ver requisições de todos", module: "Requisições" },
  { code: "requisitions.create", label: "Criar requisições", module: "Requisições" },
  { code: "requisitions.edit", label: "Editar próprios rascunhos", module: "Requisições" },
  { code: "requisitions.edit.all", label: "Editar todos os rascunhos", module: "Requisições" },
  { code: "requisitions.analyze", label: "Analisar requisições", module: "Requisições" },
  { code: "requisitions.reserve", label: "Reservar materiais", module: "Requisições" },
  { code: "requisitions.release", label: "Liberar para corte", module: "Requisições" },
  { code: "requisitions.cut", label: "Executar corte", module: "Requisições" },
  { code: "requisitions.inspect", label: "Conferir e concluir", module: "Requisições" },
  { code: "requisitions.cancel", label: "Cancelar requisições", module: "Requisições" },
  { code: "activities.read", label: "Ver atividades", module: "Atividades" },
  { code: "activities.read.all", label: "Ver atividades da equipe", module: "Atividades" },
  { code: "activities.create", label: "Criar atividades", module: "Atividades" },
  { code: "activities.edit", label: "Editar próprias atividades", module: "Atividades" },
  { code: "activities.edit.all", label: "Editar atividades da equipe", module: "Atividades" },
  { code: "activities.complete", label: "Concluir atividades", module: "Atividades" },
  { code: "activities.cancel", label: "Cancelar atividades", module: "Atividades" },
  { code: "activities.delete", label: "Excluir rascunhos", module: "Atividades" },
  { code: "activities.export", label: "Exportar atividades", module: "Atividades" },
  { code: "activities.sign", label: "Assinar atividades", module: "Atividades" },
  { code: "agenda.read", label: "Ver agenda", module: "Agenda" },
  { code: "agenda.read.all", label: "Ver agenda da equipe", module: "Agenda" },
  { code: "agenda.create", label: "Criar compromissos", module: "Agenda" },
  { code: "agenda.edit", label: "Editar próprios compromissos", module: "Agenda" },
  { code: "agenda.edit.all", label: "Editar agenda da equipe", module: "Agenda" },
  { code: "agenda.cancel", label: "Cancelar compromissos", module: "Agenda" },
  { code: "agenda.conflict.override", label: "Ignorar conflitos de agenda", module: "Agenda" },
  { code: "agenda.types.manage", label: "Gerenciar tipos de compromisso", module: "Agenda" },
  { code: "reports.read", label: "Ver relatórios", module: "Relatórios" },
  { code: "reports.export", label: "Exportar relatórios", module: "Relatórios" },
  { code: "users.read", label: "Ver usuários", module: "Usuários" },
  { code: "users.manage", label: "Gerenciar usuários", module: "Usuários" },
  { code: "audit.read", label: "Ver auditoria", module: "Auditoria" },
  { code: "notifications.read", label: "Ver notificações", module: "Notificações" },
  { code: "settings.manage", label: "Gerenciar configurações", module: "Configurações" },
  { code: "organization.read", label: "Ver quadros e tarefas", module: "Organização interna" },
  { code: "organization.read.all", label: "Ver todos os quadros", module: "Organização interna" },
  { code: "organization.manage", label: "Gerenciar quadros, colunas e etiquetas", module: "Organização interna" },
  { code: "organization.tasks.create", label: "Criar tarefas", module: "Organização interna" },
  { code: "organization.tasks.edit", label: "Atualizar tarefas atribuídas", module: "Organização interna" },
  { code: "organization.tasks.edit.all", label: "Atualizar todas as tarefas", module: "Organização interna" },
  { code: "organization.tasks.comment", label: "Comentar em tarefas", module: "Organização interna" },
  { code: "commercial.read", label: "Acessar módulo comercial", module: "Comercial" },
  { code: "commercial.read.all", label: "Ver carteira de toda a equipe", module: "Comercial" },
  { code: "commercial.manage", label: "Gerenciar funil e equipe comercial", module: "Comercial" },
  { code: "commercial.leads.manage", label: "Gerenciar leads e contatos", module: "Comercial" },
  { code: "commercial.quotes.manage", label: "Gerenciar orçamentos e propostas", module: "Comercial" },
  { code: "commercial.orders.manage", label: "Gerenciar pedidos e vendas", module: "Comercial" },
  { code: "commercial.commissions.manage", label: "Gerenciar comissões", module: "Comercial" },
  { code: "documents.read", label: "Ver documentos de projeto", module: "Documentos" },
  { code: "documents.manage", label: "Enviar e gerenciar documentos", module: "Documentos" },
  { code: "hr.read", label: "Ver RH (colaboradores e férias)", module: "RH" },
  { code: "hr.employees.manage", label: "Gerenciar colaboradores", module: "RH" },
  { code: "hr.vacations.manage", label: "Gerenciar solicitações de férias", module: "RH" },
  { code: "hr.vacations.approve", label: "Aprovar ou recusar férias", module: "RH" },
  { code: "hr.timeclock.manage", label: "Importar e ajustar ponto eletrônico", module: "RH" },
  { code: "finance.read", label: "Ver financeiro (lançamentos e resumo)", module: "Financeiro" },
  { code: "finance.manage", label: "Lançar e gerenciar movimentos financeiros", module: "Financeiro" },
] as const;

type PermissionCode = (typeof PERMISSIONS)[number]["code"];

const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.code);

const ROLE_DEFS: { name: Role["name"]; label: string; description: string; perms: PermissionCode[] }[] = [
  {
    name: "ADMIN",
    label: "Administrador",
    description: "Acesso total ao sistema",
    perms: ALL_PERMISSIONS,
  },
  {
    name: "MANAGER",
    label: "Gestor",
    description: "Gerencia produtos, estoque e aprova requisições",
    perms: [
      "dashboard.read",
      "products.read",
      "products.create",
      "products.update",
      "categories.read",
      "categories.create",
      "categories.update",
      "suppliers.read",
      "suppliers.create",
      "suppliers.update",
      "warehouses.read",
      "stock.read",
      "stock.movements",
      "stock.entry",
      "stock.exit",
      "stock.adjust",
      "stock.transfer",
      "stock.reserve",
      "stock.occurrence",
      "stock.scanner",
      "inventory.read",
      "inventory.create",
      "inventory.update",
      "inventory.adjust",
      "requisitions.read",
      "requisitions.read.all",
      "requisitions.edit.all",
      "requisitions.analyze",
      "requisitions.reserve",
      "requisitions.release",
      "requisitions.cut",
      "requisitions.inspect",
      "requisitions.cancel",
      "activities.read", "activities.read.all", "activities.create", "activities.edit", "activities.edit.all", "activities.complete", "activities.cancel", "activities.delete", "activities.export", "activities.sign",
      "agenda.read", "agenda.read.all", "agenda.create", "agenda.edit", "agenda.edit.all", "agenda.cancel", "agenda.conflict.override", "agenda.types.manage",
      "reports.read",
      "reports.export",
      "users.read",
      "notifications.read",
      "organization.read", "organization.read.all", "organization.manage", "organization.tasks.create", "organization.tasks.edit", "organization.tasks.edit.all", "organization.tasks.comment",
      "commercial.read", "commercial.read.all", "commercial.manage", "commercial.leads.manage", "commercial.quotes.manage", "commercial.orders.manage", "commercial.commissions.manage",
      "documents.read", "documents.manage",
      "hr.read", "hr.vacations.approve", "hr.timeclock.manage",
      "finance.read", "finance.manage",
    ],
  },
  {
    name: "FINANCEIRO",
    label: "Financeiro",
    description: "Gestão de receitas, despesas e contas a pagar/receber",
    perms: [
      "dashboard.read",
      "finance.read", "finance.manage",
      "reports.read",
      "notifications.read",
      "organization.read",
      "documents.read",
    ],
  },
  {
    name: "RH",
    label: "Recursos Humanos",
    description: "Gestão de pessoas: colaboradores, férias e ponto",
    perms: [
      "dashboard.read",
      "hr.read", "hr.employees.manage", "hr.vacations.manage", "hr.vacations.approve", "hr.timeclock.manage",
      "agenda.read", "agenda.read.all",
      "notifications.read",
      "users.read",
      "organization.read",
      "documents.read",
    ],
  },
  {
    name: "WAREHOUSE",
    label: "Almoxarife",
    description: "Opera o almoxarifado: entradas, saídas e inventário",
    perms: [
      "dashboard.read",
      "products.read",
      "products.update",
      "categories.read",
      "suppliers.read",
      "warehouses.read",
      "stock.read",
      "stock.movements",
      "stock.entry",
      "stock.exit",
      "stock.adjust",
      "stock.transfer",
      "stock.reserve",
      "stock.occurrence",
      "stock.scanner",
      "inventory.read",
      "inventory.create",
      "inventory.update",
      "inventory.adjust",
      "requisitions.read",
      "requisitions.read.all",
      "requisitions.reserve",
      "activities.read", "activities.read.all", "activities.create", "activities.edit", "activities.complete", "activities.cancel", "activities.export", "activities.sign",
      "agenda.read", "agenda.read.all", "agenda.create", "agenda.edit", "agenda.cancel",
      "reports.read",
      "notifications.read",
      "organization.read", "organization.read.all", "organization.tasks.create", "organization.tasks.edit", "organization.tasks.comment",
      "documents.read",
    ],
  },
  {
    name: "PRODUCTION",
    label: "Produção / Corte",
    description: "Executa e confere as peças liberadas para produção",
    perms: [
      "dashboard.read",
      "products.read",
      "stock.read",
      "requisitions.read",
      "requisitions.read.all",
      "requisitions.cut",
      "requisitions.inspect",
      "activities.read", "activities.read.all", "activities.create", "activities.edit", "activities.complete", "activities.cancel", "activities.export", "activities.sign",
      "agenda.read", "agenda.read.all", "agenda.create", "agenda.edit", "agenda.cancel",
      "notifications.read",
      "organization.read", "organization.read.all", "organization.tasks.create", "organization.tasks.edit", "organization.tasks.comment",
      "documents.read", "documents.manage",
    ],
  },
  {
    name: "REQUESTER",
    label: "Solicitante",
    description: "Cria e acompanha requisições",
    perms: [
      "dashboard.read",
      "products.read",
      "stock.read",
      "requisitions.read",
      "requisitions.create",
      "requisitions.edit",
      "requisitions.cancel",
      "activities.read", "activities.create", "activities.edit", "activities.complete", "activities.cancel", "activities.export", "activities.sign",
      "agenda.read", "agenda.create", "agenda.edit", "agenda.cancel",
      "notifications.read",
      "organization.read", "organization.tasks.create", "organization.tasks.edit", "organization.tasks.comment",
    ],
  },
  {
    name: "VIEWER",
    label: "Visualizador",
    description: "Apenas consulta dados",
    perms: ["dashboard.read", "products.read", "stock.read", "activities.read", "agenda.read", "reports.read", "notifications.read", "organization.read", "documents.read"],
  },
];

const USERS = [
  { name: "Admin Principal", email: "admin@mobieer.com.br", password: "admin123", position: "Administrador", sector: "TI", role: "ADMIN" },
  { name: "Marcos Vinícius", email: "gestor@mobieer.com.br", password: "gestor123", position: "Gestor de Produção", sector: "Produção", role: "MANAGER" },
  { name: "J. Silva", email: "almoxarife@mobieer.com.br", password: "almox123", position: "Almoxarife", sector: "Almoxarifado", role: "WAREHOUSE" },
  { name: "Ana Beatriz", email: "solicitante@mobieer.com.br", password: "sol123", position: "Supervisora de Montagem", sector: "Montagem", role: "REQUESTER" },
  { name: "Carlos Eduardo", email: "visual@mobieer.com.br", password: "visual123", position: "Diretor", sector: "Diretoria", role: "VIEWER" },
  { name: "Patrícia Nunes", email: "rh@mobieer.com.br", password: "rh123", position: "Analista de RH", sector: "Administração", role: "RH" },
  { name: "Fernanda Lima", email: "financeiro@mobieer.com.br", password: "fin123", position: "Analista Financeiro", sector: "Administração", role: "FINANCEIRO" },
];

const CATEGORIES = [
  { name: "Fixadores", description: "Parafusos, porcas, arruelas e buchas" },
  { name: "Ferramentas", description: "Ferramentas manuais e elétricas" },
  { name: "EPI", description: "Equipamentos de proteção individual" },
  { name: "Acabamento", description: "Materiais para acabamento de móveis" },
  { name: "Elétrica", description: "Componentes e materiais elétricos" },
  { name: "Embalagem", description: "Materiais para embalagem e expedição" },
  { name: "Marcenaria", description: "Chapas, bordas e insumos para madeira" },
  { name: "Hidráulica", description: "Conexões e materiais hidráulicos" },
];

const SUPPLIERS = [
  { name: "Fixadores do Brasil Ltda", cnpj: "12.345.678/0001-90", contact: "Roberto Lima", phone: "(11) 3456-7801", email: "vendas@fixadoresbrasil.com.br", address: "Rua das Indústrias, 1500 - São Paulo/SP" },
  { name: "Madeireira Sul & Cia", cnpj: "23.456.789/0001-01", contact: "Fernanda Souza", phone: "(47) 3344-5502", email: "contato@sulecia.com.br", address: "Av. dos Imigrantes, 200 - Joinville/SC" },
  { name: "Tintas e Acabamentos Premium", cnpj: "34.567.890/0001-12", contact: "Paulo Nogueira", phone: "(19) 3222-3344", email: "pedidos@tintaspra.com.br", address: "Rod. Anhanguera, km 112 - Limeira/SP" },
  { name: "EPI Total Comercial", cnpj: "45.678.901/0001-23", contact: "Juliana Castro", phone: "(51) 3012-8803", email: "comercial@epitotal.com.br", address: "Rua do Trabalhador, 88 - Caxias do Sul/RS" },
  { name: "EletroComponentes Ltda", cnpj: "56.789.012/0001-34", contact: "Sérgio Almeida", phone: "(31) 3421-7790", email: "atendimento@eletrocomp.com.br", address: "Av. Amazonas, 5000 - Belo Horizonte/MG" },
  { name: "Embalagens Modernas", cnpj: "67.890.123/0001-45", contact: "Camila Rocha", phone: "(41) 3355-2211", email: "vendas@embmodernas.com.br", address: "BR-376, km 30 - Curitiba/PR" },
];

type SeedProduct = {
  name: string;
  sku?: string;
  category: string;
  unit: Unit;
  minStock: number;
  maxStock: number;
  unitValue: number;
  supplier: string;
  corridor: string;
  shelf: string;
  position: string;
  description?: string;
};

const PRODUCTS: SeedProduct[] = [
  { name: "Parafuso sextavado M8 x 30", sku: "PFX-M8X30", category: "Fixadores", unit: Unit.UNIT, minStock: 500, maxStock: 5000, unitValue: 0.35, supplier: "Fixadores do Brasil Ltda", corridor: "B", shelf: "04", position: "02", description: "Parafuso sextavado em aço zincado" },
  { name: "Parafuso M6 x 20", sku: "PFX-M6X20", category: "Fixadores", unit: Unit.UNIT, minStock: 400, maxStock: 4000, unitValue: 0.22, supplier: "Fixadores do Brasil Ltda", corridor: "B", shelf: "04", position: "01" },
  { name: "Parafuso M5 x 16", sku: "PFX-M5X16", category: "Fixadores", unit: Unit.UNIT, minStock: 300, maxStock: 3000, unitValue: 0.15, supplier: "Fixadores do Brasil Ltda", corridor: "B", shelf: "04", position: "03" },
  { name: "Arruela lisa M8", category: "Fixadores", unit: Unit.UNIT, minStock: 200, maxStock: 2000, unitValue: 0.08, supplier: "Fixadores do Brasil Ltda", corridor: "B", shelf: "03", position: "01" },
  { name: "Porca sextavada M8", category: "Fixadores", unit: Unit.UNIT, minStock: 200, maxStock: 2000, unitValue: 0.1, supplier: "Fixadores do Brasil Ltda", corridor: "B", shelf: "03", position: "02" },
  { name: "Bucha S8 + Parafuso", category: "Fixadores", unit: Unit.PACKAGE, minStock: 100, maxStock: 1000, unitValue: 0.5, supplier: "Fixadores do Brasil Ltda", corridor: "B", shelf: "03", position: "03" },
  { name: "Fita de borda 22mm branca", sku: "BRD-22-BR", category: "Acabamento", unit: Unit.ROLL, minStock: 50, maxStock: 400, unitValue: 45.0, supplier: "Tintas e Acabamentos Premium", corridor: "A", shelf: "01", position: "02", description: "Fita de borda melamínica 22mm x 50m" },
  { name: "Fita de borda 22mm carvalho", sku: "BRD-22-CV", category: "Acabamento", unit: Unit.ROLL, minStock: 50, maxStock: 400, unitValue: 48.5, supplier: "Tintas e Acabamentos Premium", corridor: "A", shelf: "01", position: "03" },
  { name: "Fita de borda 45mm cinza", sku: "BRD-45-CZ", category: "Acabamento", unit: Unit.ROLL, minStock: 40, maxStock: 300, unitValue: 68.0, supplier: "Tintas e Acabamentos Premium", corridor: "A", shelf: "01", position: "04" },
  { name: "Cola de contato 900g", category: "Acabamento", unit: Unit.UNIT, minStock: 30, maxStock: 200, unitValue: 22.9, supplier: "Tintas e Acabamentos Premium", corridor: "A", shelf: "02", position: "01" },
  { name: "Selador incolor 3,6L", category: "Acabamento", unit: Unit.UNIT, minStock: 20, maxStock: 150, unitValue: 89.9, supplier: "Tintas e Acabamentos Premium", corridor: "A", shelf: "02", position: "02" },
  { name: "Verniz PU fosco 3,6L", category: "Acabamento", unit: Unit.UNIT, minStock: 15, maxStock: 120, unitValue: 145.0, supplier: "Tintas e Acabamentos Premium", corridor: "A", shelf: "02", position: "03" },
  { name: "Tinta spray preto 350ml", category: "Acabamento", unit: Unit.UNIT, minStock: 50, maxStock: 300, unitValue: 18.5, supplier: "Tintas e Acabamentos Premium", corridor: "A", shelf: "03", position: "01" },
  { name: "MDP 18mm branco 2,75x1,84", category: "Marcenaria", unit: Unit.UNIT, minStock: 25, maxStock: 200, unitValue: 128.0, supplier: "Madeireira Sul & Cia", corridor: "A", shelf: "05", position: "01", description: "Painel MDP com fita em borda branca" },
  { name: "MDP 18mm carvalho 2,75x1,84", category: "Marcenaria", unit: Unit.UNIT, minStock: 20, maxStock: 180, unitValue: 132.0, supplier: "Madeireira Sul & Cia", corridor: "A", shelf: "05", position: "02" },
  { name: "Chapa compensado 15mm", category: "Marcenaria", unit: Unit.UNIT, minStock: 15, maxStock: 120, unitValue: 96.0, supplier: "Madeireira Sul & Cia", corridor: "A", shelf: "05", position: "03" },
  { name: "Cavilha 8x30", category: "Marcenaria", unit: Unit.PACKAGE, minStock: 60, maxStock: 500, unitValue: 12.0, supplier: "Madeireira Sul & Cia", corridor: "C", shelf: "01", position: "01" },
  { name: "Lixa grão 120 (10 un)", category: "Marcenaria", unit: Unit.PACKAGE, minStock: 80, maxStock: 600, unitValue: 8.5, supplier: "Madeireira Sul & Cia", corridor: "C", shelf: "01", position: "02" },
  { name: "Lixa grão 180 (10 un)", category: "Marcenaria", unit: Unit.PACKAGE, minStock: 80, maxStock: 600, unitValue: 8.5, supplier: "Madeireira Sul & Cia", corridor: "C", shelf: "01", position: "03" },
  { name: "Chave Philips Nº2", category: "Ferramentas", unit: Unit.UNIT, minStock: 15, maxStock: 100, unitValue: 9.9, supplier: "Fixadores do Brasil Ltda", corridor: "C", shelf: "02", position: "01" },
  { name: "Chave de fenda Nº2", category: "Ferramentas", unit: Unit.UNIT, minStock: 15, maxStock: 100, unitValue: 8.9, supplier: "Fixadores do Brasil Ltda", corridor: "C", shelf: "02", position: "02" },
  { name: "Furadeira de bancada", category: "Ferramentas", unit: Unit.UNIT, minStock: 2, maxStock: 10, unitValue: 890.0, supplier: "EletroComponentes Ltda", corridor: "C", shelf: "03", position: "01" },
  { name: "Parafusadeira 12V", category: "Ferramentas", unit: Unit.UNIT, minStock: 5, maxStock: 30, unitValue: 320.0, supplier: "EletroComponentes Ltda", corridor: "C", shelf: "03", position: "02" },
  { name: "Serra circular 7 1/4", category: "Ferramentas", unit: Unit.UNIT, minStock: 3, maxStock: 15, unitValue: 450.0, supplier: "EletroComponentes Ltda", corridor: "C", shelf: "03", position: "03" },
  { name: "Broca madeira 10mm", category: "Ferramentas", unit: Unit.UNIT, minStock: 30, maxStock: 200, unitValue: 6.5, supplier: "Fixadores do Brasil Ltda", corridor: "C", shelf: "02", position: "03" },
  { name: "Óculos de proteção", category: "EPI", unit: Unit.UNIT, minStock: 40, maxStock: 300, unitValue: 7.5, supplier: "EPI Total Comercial", corridor: "D", shelf: "01", position: "01" },
  { name: "Luvas nitrílicas caixa", category: "EPI", unit: Unit.BOX, minStock: 30, maxStock: 200, unitValue: 18.0, supplier: "EPI Total Comercial", corridor: "D", shelf: "01", position: "02" },
  { name: "Protetor auricular", category: "EPI", unit: Unit.UNIT, minStock: 25, maxStock: 150, unitValue: 12.0, supplier: "EPI Total Comercial", corridor: "D", shelf: "01", position: "03" },
  { name: "Máscara PFF2 caixa", category: "EPI", unit: Unit.BOX, minStock: 20, maxStock: 120, unitValue: 32.0, supplier: "EPI Total Comercial", corridor: "D", shelf: "02", position: "01" },
  { name: "Botina de segurança", category: "EPI", unit: Unit.PAIR, minStock: 12, maxStock: 80, unitValue: 89.0, supplier: "EPI Total Comercial", corridor: "D", shelf: "02", position: "02" },
  { name: "Fita isolante 20m", category: "Elétrica", unit: Unit.UNIT, minStock: 40, maxStock: 300, unitValue: 4.5, supplier: "EletroComponentes Ltda", corridor: "D", shelf: "03", position: "01" },
  { name: "Cabo flexível 2,5mm (100m)", category: "Elétrica", unit: Unit.ROLL, minStock: 10, maxStock: 80, unitValue: 89.0, supplier: "EletroComponentes Ltda", corridor: "D", shelf: "03", position: "02" },
  { name: "Conector rápido 3 vias", category: "Elétrica", unit: Unit.PACKAGE, minStock: 50, maxStock: 400, unitValue: 6.9, supplier: "EletroComponentes Ltda", corridor: "D", shelf: "03", position: "03" },
  { name: "Filme stretch 500mm", category: "Embalagem", unit: Unit.ROLL, minStock: 20, maxStock: 150, unitValue: 14.5, supplier: "Embalagens Modernas", corridor: "E", shelf: "01", position: "01" },
  { name: "Caixa de papelão 60x40x40", category: "Embalagem", unit: Unit.UNIT, minStock: 100, maxStock: 800, unitValue: 4.2, supplier: "Embalagens Modernas", corridor: "E", shelf: "01", position: "02" },
  { name: "Fita adesiva 48mm (12 un)", category: "Embalagem", unit: Unit.PACKAGE, minStock: 40, maxStock: 300, unitValue: 15.9, supplier: "Embalagens Modernas", corridor: "E", shelf: "01", position: "03" },
  { name: "Cantoneira de proteção", category: "Embalagem", unit: Unit.PACKAGE, minStock: 50, maxStock: 400, unitValue: 8.0, supplier: "Embalagens Modernas", corridor: "E", shelf: "02", position: "01" },
  { name: "Mangueira 3/4 (50m)", category: "Hidráulica", unit: Unit.ROLL, minStock: 5, maxStock: 40, unitValue: 120.0, supplier: "EletroComponentes Ltda", corridor: "E", shelf: "03", position: "01" },
  { name: "Conexão T PVC 25mm", category: "Hidráulica", unit: Unit.UNIT, minStock: 30, maxStock: 200, unitValue: 3.5, supplier: "EletroComponentes Ltda", corridor: "E", shelf: "03", position: "02" },
  { name: "Vedante silicone (tubo)", category: "Hidráulica", unit: Unit.UNIT, minStock: 25, maxStock: 180, unitValue: 11.9, supplier: "Tintas e Acabamentos Premium", corridor: "E", shelf: "03", position: "03" },
];

const SECTORS = ["Montagem", "Corte", "Pintura", "Expedição", "Manutenção", "Qualidade"];
const REQUESTERS = ["Ana Beatriz", "Paulo Mendes", "Ricardo Teles", "Camila Freitas", "Diego Barros"];
const EMPLOYEES = ["J. Silva", "Ana Beatriz", "Paulo Mendes", "Ricardo Teles", "Camila Freitas", "Diego Barros"];

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysAgo(n: number, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, rand(0, 59), rand(0, 59), 0);
  return d;
}

async function truncateAll() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function main() {
  console.log("[SEED] Limpando banco...");
  await truncateAll();

  console.log("[SEED] Criando empresa e organização padrão...");
  await prisma.enterprise.upsert({
    where: { id: "default-enterprise" },
    update: { regimeTributario: "SIMPLES_NACIONAL", cnae: "3101-2/00", uf: "CE", municipio: "Fortaleza" },
    create: {
      id: "default-enterprise",
      legalName: "MOBIEER Móveis Planejados Ltda",
      tradeName: "MOBIEER",
      slug: "mobieer",
      regimeTributario: "SIMPLES_NACIONAL",
      cnae: "3101-2/00",
      uf: "CE",
      municipio: "Fortaleza",
    },
  });
  await prisma.organization.upsert({
    where: { id: "default-org" },
    update: {},
    create: { id: "default-org", name: "MOBIEER", enterpriseId: "default-enterprise" },
  });

  console.log("[SEED] Criando permissões...");
  await prisma.permission.createMany({ data: [...PERMISSIONS] });

  console.log("[SEED] Criando perfis (RBAC)...");
  const roles: Record<string, string> = {};
  const permissions = await prisma.permission.findMany({ select: { code: true, id: true } });
  const permissionIdByCode = new Map(permissions.map((p) => [p.code, p.id]));
  for (const def of ROLE_DEFS) {
    const role = await prisma.role.create({
      data: { name: def.name, label: def.label, description: def.description },
    });
    roles[def.name] = role.id;
    await prisma.rolePermission.createMany({
      data: def.perms.map((code) => ({ roleId: role.id, permissionId: permissionIdByCode.get(code)! })),
    });
  }

  console.log("[SEED] Criando usuários...");
  const userIds: Record<string, string> = {};
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    const user = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        password: hash,
        position: u.position,
        sector: u.sector,
        roleId: roles[u.role],
      },
    });
    userIds[u.name] = user.id;
  }

  console.log("[SEED] Criando almoxarifado e localizações...");
  const warehouse = await prisma.warehouse.create({
    data: { name: "Almoxarifado 01", code: "ALM-01", address: "Galpão central - Parque Industrial" },
  });

  console.log("[SEED] Criando categorias e fornecedores...");
  const categoryIds: Record<string, string> = {};
  for (const c of CATEGORIES) {
    const cat = await prisma.category.create({ data: c });
    categoryIds[cat.name] = cat.id;
  }
  const supplierIds: Record<string, string> = {};
  for (const s of SUPPLIERS) {
    const sup = await prisma.supplier.create({ data: s });
    supplierIds[sup.name] = sup.id;
  }

  console.log("[SEED] Criando produtos e movimentações...");
  const productIds: Record<string, string> = {};
  let code = 1;

  for (const p of PRODUCTS) {
    const product = await prisma.product.create({
      data: {
        name: p.name,
        code: `MAT-${String(code).padStart(5, "0")}`,
        sku: p.sku ?? null,
        description: p.description ?? null,
        unit: p.unit,
        stock: 0,
        minStock: p.minStock,
        maxStock: p.maxStock,
        unitValue: p.unitValue,
        categoryId: categoryIds[p.category],
        supplierId: supplierIds[p.supplier],
        warehouseId: warehouse.id,
        corridor: p.corridor,
        shelf: p.shelf,
        position: p.position,
      },
    });
    productIds[p.name] = product.id;
    code += 1;
  }

  // Movements history over ~8 months
  const now = new Date();
  for (const p of PRODUCTS) {
    const productId = productIds[p.name];
    let stock = 0;
    let day = 245;
    let supplierId = supplierIds[p.supplier];

    while (day > 0) {
      const moves = rand(1, 3);
      for (let i = 0; i < moves; i++) {
        if (day <= 0) break;
        const chance = Math.random();
        if (chance < 0.42) {
          // ENTRY
          const qty = p.unit === Unit.ROLL || p.unit === Unit.PACKAGE || p.unit === Unit.PAIR || p.unit === Unit.BOX ? rand(1, Math.max(2, Math.floor(p.maxStock / 12))) : rand(50, Math.floor(p.maxStock / 2));
          stock += qty;
          await prisma.stockMovement.create({
            data: {
              type: MovementType.ENTRY,
              productId,
              quantity: qty,
              unitValue: p.unitValue,
              date: daysAgo(day, rand(7, 11)),
              supplierId,
              invoiceNumber: `NF-${rand(10000, 99999)}`,
              batch: `L${rand(1, 9)}${rand(2024, 2026)}-${rand(1, 40)}`,
              responsibleId: userIds["J. Silva"],
              note: rand(0, 1) ? "Compra de reposição" : "Reposição de estoque",
            },
          });
        } else if (chance < 0.9) {
          // EXIT
          const maxQty = p.unit === Unit.ROLL || p.unit === Unit.PACKAGE || p.unit === Unit.PAIR || p.unit === Unit.BOX ? 4 : 200;
          const qty = rand(1, Math.max(1, Math.min(maxQty, stock > 0 ? Math.floor(stock * 0.6) : 1)));
          if (stock - qty < -5 && stock > 0) {
            stock -= Math.min(qty, stock);
          } else {
            stock -= qty;
          }
          if (stock < 0) stock = 0;
          await prisma.stockMovement.create({
            data: {
              type: MovementType.EXIT,
              productId,
              quantity: qty,
              date: daysAgo(day, rand(8, 17)),
              requesterName: EMPLOYEES[rand(0, EMPLOYEES.length - 1)],
              sector: SECTORS[rand(0, SECTORS.length - 1)],
              destination: "Produção",
              reason: ["Consumo na produção", "Manutenção de equipamentos", "Uso operacional", "Montagem de móveis"][rand(0, 3)],
              responsibleId: userIds["J. Silva"],
            },
          });
        } else {
          // ADJUST
          const qty = rand(1, Math.min(30, Math.max(1, p.maxStock / 10)));
          stock += qty;
          await prisma.stockMovement.create({
            data: {
              type: MovementType.ADJUST,
              productId,
              quantity: qty,
              date: daysAgo(day, rand(9, 16)),
              note: "Ajuste de inventário",
              responsibleId: userIds["J. Silva"],
            },
          });
        }
        day -= rand(1, 3);
      }
      day -= rand(0, 2);
    }

    // Force some products to alert status
    const shouldGoLow = Math.random() < 0.45;
    const finalStock = shouldGoLow ? rand(0, Math.max(0, p.minStock)) : Math.max(rand(Math.ceil(p.minStock * 1.5), p.maxStock), 1);
    if (stock !== finalStock) {
      const diff = finalStock - stock;
      if (diff !== 0) {
        await prisma.stockMovement.create({
          data: {
            type: MovementType.ADJUST,
            productId,
            quantity: Math.abs(diff),
            date: daysAgo(rand(1, 3)),
            note: diff > 0 ? "Ajuste final de seed" : "Consumo registrado",
            responsibleId: userIds["J. Silva"],
          },
        });
      }
    }
    await prisma.product.update({ where: { id: productId }, data: { stock: finalStock } });
  }

  // Stock movements in the last days for "recent" freshness
  for (const p of PRODUCTS) {
    const productId = productIds[p.name];
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) continue;
    if (Math.random() < 0.5) {
      const qty = p.unit === Unit.ROLL || p.unit === Unit.PACKAGE || p.unit === Unit.PAIR || p.unit === Unit.BOX ? rand(1, 5) : rand(10, 150);
      const type = Math.random() < 0.5 ? MovementType.ENTRY : MovementType.EXIT;
      if (type === MovementType.EXIT && product.stock - qty < 0) continue;
      await prisma.stockMovement.create({
        data: {
          type,
          productId,
          quantity: qty,
          date: daysAgo(rand(0, 4)),
          ...(type === MovementType.ENTRY
            ? { supplierId: supplierIds[p.supplier], invoiceNumber: `NF-${rand(10000, 99999)}`, batch: `L${rand(1, 9)}${2026}-${rand(1, 40)}`, responsibleId: userIds["J. Silva"], note: "Entrada de reposição" }
            : { requesterName: EMPLOYEES[rand(0, EMPLOYEES.length - 1)], sector: SECTORS[rand(0, SECTORS.length - 1)], destination: "Produção", reason: "Consumo na produção", responsibleId: userIds["J. Silva"] }),
        },
      });
      const newStock = product.stock + (type === MovementType.ENTRY ? qty : -qty);
      await prisma.product.update({ where: { id: productId }, data: { stock: Math.max(0, newStock) } });
    }
  }

  console.log("[SEED] Criando requisições...");
  const reqStatuses = ["REQUESTED", "IN_REVIEW", "WAITING_MATERIAL", "RELEASED", "IN_CUTTING", "INSPECTION", "COMPLETED", "RELEASED"];
  const activeProducts = await prisma.product.findMany({ take: 40 });
  for (let i = 0; i < 14; i++) {
    const status = reqStatuses[i % reqStatuses.length];
    const requester = REQUESTERS[i % REQUESTERS.length];
    const items = [];
    const itemCount = rand(1, 3);
    const seen = new Set<string>();
    while (items.length < itemCount) {
      const product = activeProducts[rand(0, activeProducts.length - 1)];
      if (seen.has(product.id)) continue;
      seen.add(product.id);
      items.push({ productId: product.id, description: product.name, material: product.name, quantity: rand(1, 12), unit: product.unit });
    }
    const req = await prisma.requisition.create({
      data: {
        number: `REQ-${String(i + 1).padStart(5, "0")}`,
        sector: SECTORS[i % SECTORS.length],
        destination: "Produção",
        status: status as never,
        priority: (["LOW", "NORMAL", "HIGH", "URGENT"] as const)[i % 4],
        clientName: i % 3 === 0 ? `Cliente ${i + 1}` : null,
        projectReference: `PROJ-${String(i + 1).padStart(3, "0")}`,
        neededAt: daysAgo(rand(-7, 4)),
        note: rand(0, 1) ? "Uso interno" : null,
        requesterId: userIds[requester] ?? userIds["Ana Beatriz"],
        approvedById: !["REQUESTED", "IN_REVIEW"].includes(status) ? userIds["Marcos Vinícius"] : null,
        approvedAt: !["REQUESTED", "IN_REVIEW", "WAITING_MATERIAL"].includes(status) ? daysAgo(rand(1, 10)) : null,
        submittedAt: daysAgo(rand(1, 12)),
        completedAt: status === "COMPLETED" ? daysAgo(rand(0, 4)) : null,
        createdAt: daysAgo(rand(0, 12)),
        items: { create: items },
      },
    });
    await prisma.requisitionHistory.create({ data: { requisitionId: req.id, userId: req.requesterId, action: "REQUISITION_SUBMITTED", toValue: { status } } });
  }

  console.log("[SEED] Gerando alertas de estoque...");
  const lowProducts = await prisma.product.findMany({ where: { stock: { lte: prisma.product.fields.minStock } } });
  for (const p of lowProducts) {
    const existing = await prisma.notification.findFirst({
      where: { productId: p.id, type: p.stock === 0 ? "OUT_OF_STOCK" : "LOW_STOCK", read: false },
    });
    if (!existing) {
      await prisma.notification.create({
        data: {
          type: p.stock === 0 ? "OUT_OF_STOCK" : "LOW_STOCK",
          title: p.stock === 0 ? "Produto sem estoque" : "Estoque abaixo do mínimo",
          message: `${p.name}: ${p.stock} un. disponíveis (mínimo ${p.minStock})`,
          productId: p.id,
        },
      });
    }
  }

  console.log("[SEED] Criando inventário de exemplo...");
  const inventoryProducts = await prisma.product.findMany({ take: 12 });
  const inventory = await prisma.inventory.create({
    data: {
      name: "Inventário anual 2026",
      description: "Contagem geral do almoxarifado",
      status: "OPEN",
      startedById: userIds["J. Silva"],
      items: {
        create: inventoryProducts.map((p) => ({
          productId: p.id,
          expectedQty: p.stock,
          countedQty: Math.random() < 0.4 ? Math.max(0, p.stock + rand(-5, 5)) : null,
          difference: null,
          status: Math.random() < 0.4 ? "COUNTED" : "PENDING",
        })),
      },
    },
  });
  for (const item of await prisma.inventoryItem.findMany({ where: { inventoryId: inventory.id } })) {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { difference: item.countedQty !== null ? item.countedQty - item.expectedQty : null },
    });
  }

  console.log("[SEED] Criando cliente, projeto e documentos (contrato 364-1)...");
  const ORG_ID = "default-org";
  const adminId = userIds["Admin Principal"];

  const juliana = await prisma.client.create({
    data: {
      organizationId: ORG_ID,
      name: "Juliana Costa Barboza de Castro",
      email: "adv.julianabarboza@gmail.com",
      phone: "(85) 99721-4961",
      address: "Av. Francisco Sá, 3667, Sala 12 — Fortaleza/CE",
      primaryContact: "Juliana Barboza",
      status: "ACTIVE",
    },
  });

  const projeto = await prisma.project.create({
    data: {
      organizationId: ORG_ID,
      clientId: juliana.id,
      code: "364-1",
      name: "Escritório de Advocacia — Juliana Barboza",
      description: "Marcenaria planejada do escritório: módulos superiores e inferiores, copa, guarda-volume e portas de acesso.",
      status: "COMPLETED",
      startAt: new Date("2026-07-01"),
      dueAt: new Date("2026-07-24"),
      completedAt: new Date("2026-07-27"),
      managerId: userIds["Marcos Vinícius"],
    },
  });

  const inviteToken = "dev-invite-juliana-364-1";
  await prisma.clientAccount.create({
    data: {
      clientId: juliana.id,
      name: "Juliana Barboza",
      email: "adv.julianabarboza@gmail.com",
      status: "INVITED",
      inviteToken,
      inviteExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdById: adminId,
    },
  });

  const DOCS: { file: string; type: "MANUAL_GARANTIA" | "VISTORIA_CHECKLIST" | "CRONOGRAMA" | "VISTORIA_FOTOGRAFICA"; title: string }[] = [
    { file: "CERTIFICADO GARANTIA .pdf", type: "MANUAL_GARANTIA", title: "Manual de Uso e Certificado de Garantia" },
    { file: "Checklist_Vistoria_Tecnica_Mobieer.pdf", type: "VISTORIA_CHECKLIST", title: "Checklist de Vistoria Técnica de Montagem" },
    { file: "CRONOGRAMA JULIANA 2026.pdf", type: "CRONOGRAMA", title: "Cronograma de Montagem 2026" },
    { file: "VISTORIA FOTOGRAFICA JULIANA.pdf", type: "VISTORIA_FOTOGRAFICA", title: "Vistoria Fotográfica" },
  ];
  // Arquivos-modelo ficam em docs/ na raiz do repositório (fallback: prisma/seed-assets).
  const docsDir = path.resolve(__dirname, "../../../docs");
  const assetsDir = fs.existsSync(docsDir) ? docsDir : path.resolve(__dirname, "seed-assets");
  for (const doc of DOCS) {
    const full = path.join(assetsDir, doc.file);
    if (!fs.existsSync(full)) {
      console.warn(`[SEED]   ! arquivo não encontrado, pulando: ${doc.file}`);
      continue;
    }
    const buffer = fs.readFileSync(full);
    const key = buildStorageKey(projeto.id, doc.file);
    await storage.put(key, buffer, "application/pdf");
    await prisma.projectDocument.create({
      data: {
        organizationId: ORG_ID,
        projectId: projeto.id,
        clientId: juliana.id,
        type: doc.type,
        title: doc.title,
        storageKey: key,
        fileName: doc.file.trim(),
        mimeType: "application/pdf",
        sizeBytes: buffer.byteLength,
        checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
        visibleToClient: true,
        uploadedById: adminId,
      },
    });
  }
  console.log(`[SEED]   convite do portal (dev): /portal/definir-senha?token=${inviteToken}`);

  console.log("[SEED] Criando modelos de documentos (a partir dos arquivos de docs/)...");
  const TEMPLATES: { file: string; name: string; type: "MANUAL_GARANTIA" | "VISTORIA_CHECKLIST" | "CRONOGRAMA" | "VISTORIA_FOTOGRAFICA"; requiresSignature: boolean; signerRoles: string[] }[] = [
    { file: "CERTIFICADO GARANTIA .pdf", name: "Manual de Uso e Certificado de Garantia", type: "MANUAL_GARANTIA", requiresSignature: true, signerRoles: ["MOBIEER", "CLIENTE"] },
    { file: "Checklist_Vistoria_Tecnica_Mobieer.pdf", name: "Checklist de Vistoria Técnica de Montagem", type: "VISTORIA_CHECKLIST", requiresSignature: true, signerRoles: ["TECNICO", "CLIENTE"] },
    { file: "CRONOGRAMA JULIANA 2026.pdf", name: "Cronograma de Montagem", type: "CRONOGRAMA", requiresSignature: false, signerRoles: [] },
    { file: "VISTORIA FOTOGRAFICA JULIANA.pdf", name: "Vistoria Fotográfica", type: "VISTORIA_FOTOGRAFICA", requiresSignature: false, signerRoles: [] },
  ];
  for (const tpl of TEMPLATES) {
    const full = path.join(assetsDir, tpl.file);
    if (!fs.existsSync(full)) continue;
    const buffer = fs.readFileSync(full);
    const key = buildStorageKey(`templates/${ORG_ID}`, tpl.file);
    await storage.put(key, buffer, "application/pdf");
    await prisma.documentTemplate.create({
      data: {
        organizationId: ORG_ID,
        name: tpl.name,
        type: tpl.type,
        storageKey: key,
        fileName: tpl.file.trim(),
        mimeType: "application/pdf",
        sizeBytes: buffer.byteLength,
        requiresSignature: tpl.requiresSignature,
        signerRoles: tpl.signerRoles,
        visibleToClient: true,
        createdById: adminId,
      },
    });
  }

  console.log("[SEED] Criando RH (colaboradores e férias)...");
  const today = new Date();
  const addDays = (base: Date, d: number) => new Date(base.getTime() + d * 86400000);
  const addYears = (base: Date, y: number) => new Date(new Date(base).setFullYear(base.getFullYear() + y));

  const HR_EMPLOYEES: { name: string; role: string; sector: string; userKey?: string; admitYearsAgo: number; concessionInDays: number; daysTaken: number }[] = [
    { name: "Marcos Vinícius", role: "Gestor de Produção", sector: "Produção", userKey: "Marcos Vinícius", admitYearsAgo: 4, concessionInDays: 40, daysTaken: 0 },
    { name: "J. Silva", role: "Almoxarife", sector: "Almoxarifado", userKey: "J. Silva", admitYearsAgo: 3, concessionInDays: -15, daysTaken: 0 },
    { name: "Ana Beatriz", role: "Supervisora de Montagem", sector: "Montagem", userKey: "Ana Beatriz", admitYearsAgo: 2, concessionInDays: 120, daysTaken: 10 },
    { name: "Rafael Torres", role: "Montador", sector: "Montagem", admitYearsAgo: 2, concessionInDays: 200, daysTaken: 0 },
    { name: "Diego Alencar", role: "Auxiliar de Produção", sector: "Produção", admitYearsAgo: 1, concessionInDays: 260, daysTaken: 0 },
  ];

  let empSeq = 0;
  const empByName: Record<string, string> = {};
  for (const emp of HR_EMPLOYEES) {
    empSeq++;
    const admittedAt = addYears(today, -emp.admitYearsAgo);
    const created = await prisma.employee.create({
      data: {
        organizationId: ORG_ID,
        registration: `EMP-${String(empSeq).padStart(4, "0")}`,
        fullName: emp.name,
        role: emp.role,
        sector: emp.sector,
        admittedAt,
        weeklyHours: 44,
        status: "ACTIVE",
        userId: emp.userKey ? userIds[emp.userKey] : null,
      },
    });
    empByName[emp.name] = created.id;
    const concessionLimit = addDays(today, emp.concessionInDays);
    await prisma.vacationPeriod.create({
      data: {
        employeeId: created.id,
        accrualStart: addYears(concessionLimit, -2),
        accrualEnd: addYears(concessionLimit, -1),
        concessionLimit,
        daysEntitled: 30,
        daysTaken: emp.daysTaken,
        status: emp.daysTaken > 0 ? "SCHEDULED" : "OPEN",
      },
    });
  }

  // Duas férias aprovadas sobrepostas no setor Montagem -> alerta de colisão.
  const anaPeriod = await prisma.vacationPeriod.findFirst({ where: { employeeId: empByName["Ana Beatriz"] } });
  const rafaelPeriod = await prisma.vacationPeriod.findFirst({ where: { employeeId: empByName["Rafael Torres"] } });
  const vacStart = addDays(today, 30);
  await prisma.vacationRequest.create({
    data: { employeeId: empByName["Ana Beatriz"], periodId: anaPeriod?.id ?? null, startDate: vacStart, endDate: addDays(vacStart, 9), days: 10, status: "APPROVED", decidedById: adminId, decidedAt: today },
  });
  await prisma.vacationRequest.create({
    data: { employeeId: empByName["Rafael Torres"], periodId: rafaelPeriod?.id ?? null, startDate: addDays(vacStart, 5), endDate: addDays(vacStart, 19), days: 15, status: "APPROVED", decidedById: adminId, decidedAt: today },
  });
  // Uma solicitação pendente de aprovação.
  const diegoPeriod = await prisma.vacationPeriod.findFirst({ where: { employeeId: empByName["Diego Alencar"] } });
  await prisma.vacationRequest.create({
    data: { employeeId: empByName["Diego Alencar"], periodId: diegoPeriod?.id ?? null, startDate: addDays(today, 45), endDate: addDays(today, 59), days: 15, status: "REQUESTED" },
  });

  console.log("[SEED] Criando ponto eletrônico (aparelho + marcações do mês)...");
  await prisma.timeClockDevice.create({
    data: { organizationId: ORG_ID, name: "Relógio - Portaria", model: "KNUP KP-1028", location: "Fábrica - entrada" },
  });
  const pontoEmpId = empByName["J. Silva"];
  const at = (day: number, h: number, mi: number) => new Date(today.getFullYear(), today.getMonth(), day, h, mi, 0);
  const pontoRows: { organizationId: string; employeeId: string; timestamp: Date; kind: "IN" | "OUT" | "BREAK_OUT" | "BREAK_IN"; source: "DEVICE_IMPORT" }[] = [];
  for (let day = 1; day <= Math.min(today.getDate(), 20); day++) {
    const wd = new Date(today.getFullYear(), today.getMonth(), day).getDay();
    if (wd === 0 || wd === 6) continue; // fim de semana
    if (day === 7 || day === 8) continue; // 2 faltas de exemplo
    const jitter = ((day * 7) % 11) - 5; // ±5 min
    pontoRows.push(
      { organizationId: ORG_ID, employeeId: pontoEmpId, timestamp: at(day, 8, Math.max(0, 2 + jitter)), kind: "IN", source: "DEVICE_IMPORT" },
      { organizationId: ORG_ID, employeeId: pontoEmpId, timestamp: at(day, 12, 1), kind: "BREAK_OUT", source: "DEVICE_IMPORT" },
      { organizationId: ORG_ID, employeeId: pontoEmpId, timestamp: at(day, 13, 3), kind: "BREAK_IN", source: "DEVICE_IMPORT" },
      { organizationId: ORG_ID, employeeId: pontoEmpId, timestamp: at(day, 17, Math.max(0, 4 + jitter)), kind: "OUT", source: "DEVICE_IMPORT" }
    );
  }
  if (pontoRows.length) await prisma.timeEntry.createMany({ data: pontoRows, skipDuplicates: true });

  console.log("[SEED] Criando lançamentos financeiros...");
  const monthRef = (offset: number) => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 12);
    return d;
  };
  const FIN: { type: "RECEITA" | "DESPESA"; category: string; amount: number; monthOffset: number; status: "PENDENTE" | "PAGO"; description: string; projectId?: string; clientId?: string; supplierName?: string; dueOffset?: number }[] = [
    { type: "RECEITA", category: "Contrato — sinal", amount: 18500, monthOffset: -2, status: "PAGO", description: "Entrada 50% — contrato 364-1", projectId: projeto.id, clientId: juliana.id },
    { type: "RECEITA", category: "Contrato — parcela", amount: 18500, monthOffset: 0, status: "PENDENTE", description: "Parcela final — contrato 364-1", projectId: projeto.id, clientId: juliana.id, dueOffset: 12 },
    { type: "DESPESA", category: "Matéria-prima", amount: 7200, monthOffset: -1, status: "PAGO", description: "Chapas MDF e fitas de borda", supplierName: "Madeireira Sul & Cia" },
    { type: "DESPESA", category: "Ferragens", amount: 2650, monthOffset: -1, status: "PAGO", description: "Corrediças e dobradiças", supplierName: "Fixadores do Brasil Ltda" },
    { type: "DESPESA", category: "Acabamento", amount: 1980, monthOffset: 0, status: "PENDENTE", description: "Tinta PU e selador", supplierName: "Tintas e Acabamentos Premium", dueOffset: 8 },
    { type: "DESPESA", category: "Folha de pagamento", amount: 21400, monthOffset: 0, status: "PAGO", description: "Salários da produção", },
    { type: "DESPESA", category: "Frete", amount: 900, monthOffset: 0, status: "PENDENTE", description: "Entrega e montagem in loco", dueOffset: 5 },
  ];
  for (const f of FIN) {
    const d = monthRef(f.monthOffset);
    await prisma.financeTransaction.create({
      data: {
        organizationId: ORG_ID,
        type: f.type,
        category: f.category,
        amount: f.amount.toFixed(2),
        date: d,
        dueDate: f.dueOffset ? addDays(today, f.dueOffset) : null,
        description: f.description,
        status: f.status,
        paidAt: f.status === "PAGO" ? d : null,
        projectId: f.projectId ?? null,
        clientId: f.clientId ?? null,
        supplierId: f.supplierName ? supplierIds[f.supplierName] : null,
        createdById: adminId,
      },
    });
  }

  console.log("[SEED] Criando regras fiscais (dados de desenvolvimento — trocar por regras oficiais)...");
  type RuleSeed = { regimeTributario: "SIMPLES_NACIONAL" | "LUCRO_PRESUMIDO" | "LUCRO_REAL"; tipoImposto: "DAS" | "IRPJ" | "CSLL" | "PIS" | "COFINS" | "ISS" | "ICMS"; aliquota: number; reducaoBase?: number; faixaFaturamentoMin?: number; faixaFaturamentoMax?: number; descricao: string };
  const TAX_RULES: RuleSeed[] = [
    // Simples Nacional — DAS por faixa de faturamento mensal (aprox. Anexo II)
    { regimeTributario: "SIMPLES_NACIONAL", tipoImposto: "DAS", aliquota: 0.045, faixaFaturamentoMin: 0, faixaFaturamentoMax: 15000, descricao: "Simples — 1ª faixa" },
    { regimeTributario: "SIMPLES_NACIONAL", tipoImposto: "DAS", aliquota: 0.078, faixaFaturamentoMin: 15000, faixaFaturamentoMax: 30000, descricao: "Simples — 2ª faixa" },
    { regimeTributario: "SIMPLES_NACIONAL", tipoImposto: "DAS", aliquota: 0.10, faixaFaturamentoMin: 30000, faixaFaturamentoMax: 60000, descricao: "Simples — 3ª faixa" },
    { regimeTributario: "SIMPLES_NACIONAL", tipoImposto: "DAS", aliquota: 0.112, faixaFaturamentoMin: 60000, faixaFaturamentoMax: 150000, descricao: "Simples — 4ª faixa" },
    // Lucro Presumido
    { regimeTributario: "LUCRO_PRESUMIDO", tipoImposto: "PIS", aliquota: 0.0065, descricao: "PIS cumulativo" },
    { regimeTributario: "LUCRO_PRESUMIDO", tipoImposto: "COFINS", aliquota: 0.03, descricao: "COFINS cumulativo" },
    { regimeTributario: "LUCRO_PRESUMIDO", tipoImposto: "IRPJ", aliquota: 0.15, reducaoBase: 0.08, descricao: "IRPJ s/ presunção 8%" },
    { regimeTributario: "LUCRO_PRESUMIDO", tipoImposto: "CSLL", aliquota: 0.09, reducaoBase: 0.12, descricao: "CSLL s/ presunção 12%" },
    { regimeTributario: "LUCRO_PRESUMIDO", tipoImposto: "ISS", aliquota: 0.05, descricao: "ISS montagem (serviço)" },
    // Lucro Real (simplificado)
    { regimeTributario: "LUCRO_REAL", tipoImposto: "PIS", aliquota: 0.0165, descricao: "PIS não cumulativo" },
    { regimeTributario: "LUCRO_REAL", tipoImposto: "COFINS", aliquota: 0.076, descricao: "COFINS não cumulativo" },
    { regimeTributario: "LUCRO_REAL", tipoImposto: "IRPJ", aliquota: 0.15, descricao: "IRPJ" },
    { regimeTributario: "LUCRO_REAL", tipoImposto: "CSLL", aliquota: 0.09, descricao: "CSLL" },
    { regimeTributario: "LUCRO_REAL", tipoImposto: "ISS", aliquota: 0.05, descricao: "ISS montagem (serviço)" },
  ];
  const vigenciaInicio = new Date(today.getFullYear(), 0, 1);
  for (const r of TAX_RULES) {
    await prisma.taxRule.create({
      data: {
        organizationId: ORG_ID,
        regimeTributario: r.regimeTributario,
        tipoImposto: r.tipoImposto,
        aliquota: r.aliquota.toString(),
        reducaoBase: r.reducaoBase != null ? r.reducaoBase.toString() : null,
        faixaFaturamentoMin: r.faixaFaturamentoMin != null ? r.faixaFaturamentoMin.toString() : null,
        faixaFaturamentoMax: r.faixaFaturamentoMax != null ? r.faixaFaturamentoMax.toString() : null,
        descricao: r.descricao,
        vigenciaInicio,
      },
    });
  }

  const totalProducts = await prisma.product.count();
  const totalStock = await prisma.product.aggregate({ _sum: { stock: true } });
  console.log(`[SEED] Concluído! ${totalProducts} produtos, ${totalStock._sum.stock} unidades em estoque.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
