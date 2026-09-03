export type Role = "ADMIN" | "MANAGER" | "WAREHOUSE" | "PRODUCTION" | "REQUESTER" | "VIEWER" | "RH" | "FINANCEIRO";

export type FinanceType = "RECEITA" | "DESPESA";
export type FinanceStatus = "PENDENTE" | "PAGO";

export type FinanceTransaction = {
  id: string;
  type: FinanceType;
  category: string;
  amount: number;
  date: string;
  dueDate: string | null;
  description: string | null;
  status: FinanceStatus;
  paidAt: string | null;
  method: string | null;
  createdAt: string;
  project: { id: string; code: string; name: string } | null;
  client: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
};

export type FinanceSummary = {
  totalReceitas: number;
  totalDespesas: number;
  saldo: number;
  aReceber: number;
  aPagar: number;
  totalLancamentos: number;
  porCategoria: { category: string; type: FinanceType; total: number }[];
  porMes: { month: string; receitas: number; despesas: number }[];
};

export type Dre = {
  periodo: { de: string; ate: string; base: "realizado" | "competência" };
  receitas: { categoria: string; valor: number }[];
  despesas: { categoria: string; valor: number }[];
  totalReceitas: number;
  totalDespesas: number;
  resultado: number;
  margem: number;
  totalLancamentos: number;
};

export type CashflowPoint = {
  month: string;
  entradas: number;
  saidas: number;
  entradasPrevistas: number;
  saidasPrevistas: number;
  resultado: number;
  saldoAcumulado: number;
};

export type DocumentSignatureStatus = "NOT_REQUIRED" | "PENDING" | "SIGNED";

export type DocumentTemplate = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  requiresSignature: boolean;
  signerRoles: string[];
  visibleToClient: boolean;
  active: boolean;
  createdAt: string;
  generatedCount: number;
  downloadUrl: string;
};

export type DocSignature = { id: string; role: string; signerName: string; signedAt: string };

export type TimeMirrorDay = {
  date: string;
  weekday: number;
  punches: { time: string; kind: string }[];
  workedMinutes: number;
  expectedMinutes: number;
  balanceMinutes: number;
  status: "OK" | "INCOMPLETO" | "FALTA" | "FOLGA";
};

export type TimeMirror = {
  employee: { id: string; fullName: string; registration: string; weeklyHours: number };
  month: string;
  days: TimeMirrorDay[];
  totalWorked: number;
  totalExpected: number;
  balance: number;
  faltas: number;
};

export type RegimeTributario = "SIMPLES_NACIONAL" | "LUCRO_PRESUMIDO" | "LUCRO_REAL";
export type TipoImposto = "DAS" | "IRPJ" | "CSLL" | "PIS" | "COFINS" | "ISS" | "ICMS";

export type TaxCompany = {
  legalName: string;
  tradeName: string | null;
  document: string | null;
  regimeTributario: RegimeTributario;
  cnae: string | null;
  uf: string | null;
  municipio: string | null;
  inscricaoEstadual: string | null;
};

export type TaxRule = {
  id: string;
  regimeTributario: RegimeTributario;
  tipoImposto: TipoImposto;
  cnae: string | null;
  uf: string | null;
  aliquota: number;
  reducaoBase: number | null;
  faixaFaturamentoMin: number | null;
  faixaFaturamentoMax: number | null;
  descricao: string | null;
  ativo: boolean;
};

export type TaxApuracao = {
  regime: RegimeTributario;
  competencia: string;
  faturamento: number;
  impostos: { tipoImposto: string; descricao: string | null; base: number; aliquotaAplicada: number; valor: number }[];
  totalImpostos: number;
  cargaEfetiva: number;
};

export type EmployeeStatus = "ACTIVE" | "ON_LEAVE" | "TERMINATED";
export type VacationRequestStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "SCHEDULED" | "TAKEN" | "CANCELLED";
export type VacationPeriodStatus = "OPEN" | "SCHEDULED" | "CONCLUDED";

export type Employee = {
  id: string;
  registration: string;
  fullName: string;
  role: string | null;
  sector: string | null;
  status: EmployeeStatus;
  admittedAt: string;
  user: { id: string; name: string } | null;
  openPeriod: { daysRemaining: number; concessionLimit: string } | null;
};

export type VacationPeriod = {
  id: string;
  accrualStart: string;
  accrualEnd: string;
  concessionLimit: string;
  daysEntitled: number;
  daysTaken: number;
  status: VacationPeriodStatus;
};

export type VacationRequest = {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  days: number;
  sellDays: number;
  status: VacationRequestStatus;
  note: string | null;
  decidedAt: string | null;
  employee?: { id: string; fullName: string; registration: string; sector: string | null };
  decidedBy?: { id: string; name: string } | null;
};

export type HrAlert = {
  kind: "CONCESSION_EXPIRING" | "CONCESSION_OVERDUE" | "TEAM_COLLISION";
  severity: "HIGH" | "MEDIUM";
  employeeId?: string;
  employeeName?: string;
  message: string;
  dueAt?: string;
};

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

export type ActivityStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type ActivityAttachment = { id?: string; name: string; url: string; mimeType?: string | null; size?: number | null; kind: "PHOTO" | "FILE" | "PROBLEM_PHOTO" };
export type ActivityMaterial = { id?: string; name: string; productId?: string | null; product?: Pick<Product, "id" | "name" | "code" | "unit"> | null; quantity: number; unit: Unit; note?: string | null };
export type ActivityProblem = { id?: string; description: string; note?: string | null; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT"; attachments: ActivityAttachment[] };
export type Activity = {
  id: string; number: string; status: ActivityStatus; date: string; startTime: string | null; endTime: string | null; sector: string | null;
  clientName: string | null; projectReference: string | null; service: string; description: string; problemsSummary: string | null; observations: string | null;
  signatureRequired: boolean; completedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string;
  employeeId: string; employee: { id: string; name: string; sector: string | null; position?: string | null }; createdBy?: { id: string; name: string };
  materials: ActivityMaterial[]; problems: ActivityProblem[]; attachments: ActivityAttachment[];
  signatures: { id: string; role: "EMPLOYEE" | "CLIENT" | "INSPECTOR"; signerName: string; dataUrl: string; signedAt: string }[];
  history: { id: string; action: string; details?: Record<string, unknown>; createdAt: string; user?: { id: string; name: string } | null }[];
  _count?: { materials: number; problems: number; attachments: number };
};

export type StockStatus = "NORMAL" | "ATENCAO" | "CRITICO" | "SEM_ESTOQUE";

export type Product = {
  id: string;
  name: string;
  code: string;
  sku: string | null;
  barcode: string | null;
  qrCode: string | null;
  description: string | null;
  unit: Unit;
  stock: number;
  reservedStock: number;
  availableStock: number;
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
  warehouseStocks?: { quantity: number; warehouse: { id: string; name: string; code: string } }[];
};

export type Category = {
  id: string;
  name: string;
  description: string | null;
  productCount: number;
  createdAt: string;
  parent?: { id: string; name: string } | null;
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

export type MovementType = "ENTRY" | "EXIT" | "ADJUST" | "TRANSFER" | "RESERVE" | "RELEASE" | "RETURN" | "LOSS" | "DAMAGE";

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
  originWarehouse?: { id: string; name: string; code: string } | null;
  destinationWarehouse?: { id: string; name: string; code: string } | null;
  operationCode?: string | null;
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
  | "DRAFT"
  | "REQUESTED"
  | "IN_REVIEW"
  | "WAITING_MATERIAL"
  | "RELEASED"
  | "IN_CUTTING"
  | "INSPECTION"
  | "COMPLETED"
  | "CANCELLED";

export type RequisitionPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type RequisitionItemStatus = "PENDING" | "CUTTING" | "CUT" | "INSPECTED";

export type Requisition = {
  id: string;
  number: string;
  sector: string | null;
  destination: string | null;
  clientName: string | null;
  projectReference: string | null;
  priority: RequisitionPriority;
  neededAt: string | null;
  inspectionResult: "APPROVED" | "NEEDS_CORRECTION" | null;
  inspectionNote: string | null;
  status: RequisitionStatus;
  statusLabel: string;
  note: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requester: { id: string; name: string; sector: string | null; position: string | null };
  approvedBy: { id: string; name: string } | null;
  responsible: { id: string; name: string } | null;
  cutter: { id: string; name: string } | null;
  inspector: { id: string; name: string } | null;
  itemCount: number;
  totalQty: number;
  completedQty: number;
  progress: number;
  overdue: boolean;
  items: {
    id: string;
    description: string;
    material: string | null;
    productId: string | null;
    thickness: number | null;
    length: number | null;
    width: number | null;
    quantity: number;
    unit: Unit;
    edgeFinish: string | null;
    note: string | null;
    status: RequisitionItemStatus;
    reservedQuantity: number;
    product: { id: string; name: string; code: string; unit: Unit; stock: number; reservedStock: number } | null;
    availability: { physical: number; reserved: number; available: number; situation: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" } | null;
  }[];
  history: { id: string; action: string; fromValue: unknown; toValue: unknown; note: string | null; createdAt: string; user: { id: string; name: string } | null }[];
  attachments: { id: string; name: string; url: string; mimeType: string | null; size: number | null; createdAt: string }[];
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
  requisitions: { open: number; waitingMaterial: number; released: number; inCutting: number; overdue: number; recentlyCompleted: number };
  activities: { today: number; inProgress: number; completed: number; withProblems: number; hours: number; bySector: { sector: string; total: number }[] };
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
