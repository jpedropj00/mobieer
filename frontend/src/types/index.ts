export type Role = "ADMIN" | "MANAGER" | "WAREHOUSE" | "REQUESTER" | "VIEWER";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  position: string | null;
  sector: string | null;
  imageUrl: string | null;
  status: string;
  role: Role;
  roleLabel: string;
  permissions: string[];
};

export type Unit = "UNIT" | "BOX" | "PACKAGE" | "METER" | "LITER" | "KILO" | "ROLL" | "PAIR";

export type StockStatus = "NORMAL" | "ATENCAO" | "CRITICO" | "SEM_ESTOQUE";

export type Product = {
  id: string;
  name: string;
  code: string;
  sku: string | null;
  description: string | null;
  unit: Unit;
  stock: number;
  minStock: number;
  maxStock: number | null;
  unitValue: number | null;
  imageUrl: string | null;
  status: "ACTIVE" | "INACTIVE";
  location: {
    warehouseId: string;
    warehouse: string;
    corridor: string | null;
    shelf: string | null;
    position: string | null;
    full: string;
  } | null;
  category: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  stockStatus: StockStatus;
  createdAt: string;
};

export type Category = {
  id: string;
  name: string;
  description: string | null;
  productCount: number;
  createdAt: string;
};

export type Supplier = {
  id: string;
  name: string;
  cnpj: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: "ACTIVE" | "INACTIVE";
  productCount: number;
  createdAt: string;
};

export type Warehouse = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  productCount: number;
  createdAt: string;
};

export type MovementType = "ENTRY" | "EXIT" | "ADJUST";

export type Movement = {
  id: string;
  type: MovementType;
  quantity: number;
  unitValue: number | null;
  date: string;
  note: string | null;
  invoiceNumber: string | null;
  batch: string | null;
  requesterName: string | null;
  sector: string | null;
  destination: string | null;
  reason: string | null;
  product: { id: string; name: string; code: string; unit: Unit };
  responsible: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  requisition: { id: string; number: string } | null;
};

export type StockAlert = {
  productId: string;
  name: string;
  code: string;
  unit: Unit;
  stock: number;
  minStock: number;
  maxStock: number | null;
  status: StockStatus;
  category: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  warehouse: { id: string; name: string } | null;
  location: string | null;
};

export type RequisitionStatus =
  | "PENDING"
  | "IN_REVIEW"
  | "APPROVED"
  | "SEPARATION"
  | "CONCLUDED"
  | "REFUSED"
  | "CANCELLED";

export type Requisition = {
  id: string;
  number: string;
  sector: string | null;
  destination: string | null;
  status: RequisitionStatus;
  statusLabel: string;
  note: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requester: { id: string; name: string; sector: string | null; position: string | null };
  approvedBy: { id: string; name: string } | null;
  itemCount: number;
  totalQty: number;
  items: {
    id: string;
    quantity: number;
    status: string;
    product: { id: string; name: string; code: string; unit: Unit; stock: number };
  }[];
};

export type InventoryStatus = "OPEN" | "IN_PROGRESS" | "CONCLUDED" | "CANCELLED";

export type Inventory = {
  id: string;
  name: string;
  description: string | null;
  status: InventoryStatus;
  concludedAt: string | null;
  createdAt: string;
  startedBy: { id: string; name: string };
  itemCount: number;
  counted?: number;
  divergences?: number;
  items?: {
    id: string;
    expectedQty: number;
    countedQty: number | null;
    difference: number | null;
    status: string;
    product: { id: string; name: string; code: string; unit: Unit; stock: number; category: { id: string; name: string } | null; warehouse: { id: string; name: string } | null };
  }[];
};

export type Dashboard = {
  kpis: {
    totalItems: number;
    totalStock: number;
    entriesMonth: number;
    exitsMonth: number;
    alerts: number;
    previous: {
      entriesMonth: number;
      exitsMonth: number;
      entriesChangePercent: number | null;
      exitsChangePercent: number | null;
    };
  };
  balance: number;
  recentMovements: {
    id: string;
    type: MovementType;
    quantity: number;
    date: string;
    note: string | null;
    product: { id: string; name: string; code: string; unit: Unit };
    responsible: { id: string; name: string } | null;
  }[];
};

export type ChartData = {
  period: string;
  labels: string[];
  entries: number[];
  exits: number[];
  balance: number[];
  currentBalance: number;
};

export type ChartPeriod = "7d" | "30d" | "3m" | "6m" | "1y";

export type Paginated<T> = {
  success: boolean;
  data: T;
  meta: { page: number; perPage: number; total: number; pages: number };
};

export type User = {
  id: string;
  name: string;
  email: string;
  position: string | null;
  sector: string | null;
  status: "ACTIVE" | "INACTIVE";
  imageUrl: string | null;
  lastLogin: string | null;
  createdAt: string;
  role: { id: string; name: Role; label: string };
};

export type RoleInfo = {
  id: string;
  name: Role;
  label: string;
  description: string | null;
  userCount: number;
  permissions: { id: string; code: string; label: string; module: string }[];
};

export type Permission = {
  id: string;
  code: string;
  label: string;
  module: string;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  read: boolean;
  createdAt: string;
  product: { id: string; name: string; code: string } | null;
};

export type AuditLog = {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: unknown;
  ip: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

export type SearchResults = {
  products: Product[];
  movements: { id: string; type: MovementType; quantity: number; date: string; product: { id: string; name: string; code: string } }[];
  requisitions: { id: string; number: string; status: RequisitionStatus; requester: { id: string; name: string } }[];
  users: { id: string; name: string; email: string; position: string | null; sector: string | null }[];
  suppliers: { id: string; name: string; cnpj: string | null; contact: string | null }[];
};
