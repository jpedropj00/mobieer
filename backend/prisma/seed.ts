import { PrismaClient, Role, Unit, MovementType } from "@prisma/client";
import bcrypt from "bcryptjs";

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
  { code: "inventory.read", label: "Ver inventários", module: "Inventário" },
  { code: "inventory.create", label: "Criar inventários", module: "Inventário" },
  { code: "inventory.update", label: "Realizar contagem", module: "Inventário" },
  { code: "inventory.adjust", label: "Ajustar divergências", module: "Inventário" },
  { code: "requisitions.read", label: "Ver requisições", module: "Requisições" },
  { code: "requisitions.create", label: "Criar requisições", module: "Requisições" },
  { code: "requisitions.approve", label: "Aprovar/recusar", module: "Requisições" },
  { code: "requisitions.separate", label: "Separar materiais", module: "Requisições" },
  { code: "requisitions.finish", label: "Finalizar requisições", module: "Requisições" },
  { code: "requisitions.cancel", label: "Cancelar requisições", module: "Requisições" },
  { code: "reports.read", label: "Ver relatórios", module: "Relatórios" },
  { code: "reports.export", label: "Exportar relatórios", module: "Relatórios" },
  { code: "users.read", label: "Ver usuários", module: "Usuários" },
  { code: "users.manage", label: "Gerenciar usuários", module: "Usuários" },
  { code: "audit.read", label: "Ver auditoria", module: "Auditoria" },
  { code: "notifications.read", label: "Ver notificações", module: "Notificações" },
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
      "inventory.read",
      "inventory.create",
      "inventory.update",
      "inventory.adjust",
      "requisitions.read",
      "requisitions.approve",
      "requisitions.separate",
      "requisitions.finish",
      "requisitions.cancel",
      "reports.read",
      "reports.export",
      "users.read",
      "notifications.read",
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
      "inventory.read",
      "inventory.create",
      "inventory.update",
      "inventory.adjust",
      "requisitions.read",
      "requisitions.separate",
      "requisitions.finish",
      "reports.read",
      "notifications.read",
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
      "requisitions.cancel",
      "notifications.read",
    ],
  },
  {
    name: "VIEWER",
    label: "Visualizador",
    description: "Apenas consulta dados",
    perms: ["dashboard.read", "products.read", "stock.read", "reports.read", "notifications.read"],
  },
];

const USERS = [
  { name: "Admin Principal", email: "admin@mobieer.com.br", password: "admin123", position: "Administrador", sector: "TI", role: "ADMIN" },
  { name: "Marcos Vinícius", email: "gestor@mobieer.com.br", password: "gestor123", position: "Gestor de Produção", sector: "Produção", role: "MANAGER" },
  { name: "J. Silva", email: "almoxarife@mobieer.com.br", password: "almox123", position: "Almoxarife", sector: "Almoxarifado", role: "WAREHOUSE" },
  { name: "Ana Beatriz", email: "solicitante@mobieer.com.br", password: "sol123", position: "Supervisora de Montagem", sector: "Montagem", role: "REQUESTER" },
  { name: "Carlos Eduardo", email: "visual@mobieer.com.br", password: "visual123", position: "Diretor", sector: "Diretoria", role: "VIEWER" },
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

async function main() {
  console.log("[SEED] Limpando banco...");
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.requisitionItem.deleteMany();
  await prisma.requisition.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();

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
  const reqStatuses = ["PENDING", "IN_REVIEW", "APPROVED", "SEPARATION", "CONCLUDED", "REFUSED", "CONCLUDED", "APPROVED"];
  const activeProducts = await prisma.product.findMany({ take: 40 });
  for (let i = 0; i < 14; i++) {
    const status = reqStatuses[i % reqStatuses.length];
    const requester = REQUESTERS[i % REQUESTERS.length];
    const items = [];
    const itemCount = rand(1, 3);
    for (let j = 0; j < itemCount; j++) {
      const product = activeProducts[rand(0, activeProducts.length - 1)];
      items.push({ productId: product.id, quantity: rand(5, 60) });
    }
    const req = await prisma.requisition.create({
      data: {
        number: `REQ-${String(i + 1).padStart(5, "0")}`,
        sector: SECTORS[i % SECTORS.length],
        destination: "Produção",
        status: status as never,
        note: rand(0, 1) ? "Uso interno" : null,
        requesterId: userIds[requester] ?? userIds["Ana Beatriz"],
        approvedById: status === "APPROVED" || status === "SEPARATION" || status === "CONCLUDED" ? userIds["Marcos Vinícius"] : null,
        approvedAt: status === "APPROVED" || status === "SEPARATION" || status === "CONCLUDED" ? daysAgo(rand(1, 10)) : null,
        createdAt: daysAgo(rand(0, 12)),
        items: { create: items },
      },
    });
    if (status === "CONCLUDED") {
      for (const it of items) {
        const product = await prisma.product.findUnique({ where: { id: it.productId } });
        if (product && product.stock >= it.quantity) {
          await prisma.stockMovement.create({
            data: {
              type: MovementType.EXIT,
              productId: it.productId,
              quantity: it.quantity,
              date: daysAgo(rand(0, 4)),
              requesterName: requester,
              sector: req.sector,
              destination: "Produção",
              reason: `Requisição ${req.number}`,
              responsibleId: userIds["J. Silva"],
              requisitionId: req.id,
            },
          });
          await prisma.product.update({ where: { id: it.productId }, data: { stock: { decrement: it.quantity } } });
        }
      }
    }
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
