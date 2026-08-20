import { Badge } from "@/components/ui/badge";
import type { MovementType } from "@/types";

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  ENTRY: "Entrada",
  EXIT: "Saída",
  ADJUST: "Ajuste",
  TRANSFER: "Transferência",
  RESERVE: "Reserva",
  RELEASE: "Liberação",
  RETURN: "Devolução",
  LOSS: "Perda",
  DAMAGE: "Avaria",
};

export function MovementBadge({ type }: { type: MovementType }) {
  if (type === "ENTRY") return <Badge variant="success">{MOVEMENT_LABEL.ENTRY}</Badge>;
  if (type === "EXIT") return <Badge variant="danger">{MOVEMENT_LABEL.EXIT}</Badge>;
  if (type === "RETURN") return <Badge variant="success">{MOVEMENT_LABEL.RETURN}</Badge>;
  if (type === "LOSS" || type === "DAMAGE") return <Badge variant="danger">{MOVEMENT_LABEL[type]}</Badge>;
  return <Badge variant="warning">{MOVEMENT_LABEL[type]}</Badge>;
}

export const REQUISITION_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "success" | "danger" | "warning" | "muted" }> = {
  PENDING: { label: "Pendente", variant: "warning" },
  IN_REVIEW: { label: "Em análise", variant: "secondary" },
  APPROVED: { label: "Aprovada", variant: "success" },
  SEPARATION: { label: "Separação", variant: "default" },
  CONCLUDED: { label: "Concluída", variant: "success" },
  REFUSED: { label: "Recusada", variant: "danger" },
  CANCELLED: { label: "Cancelada", variant: "muted" },
};

export function RequisitionStatusBadge({ status }: { status: string }) {
  const cfg = REQUISITION_STATUS[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export const STOCK_STATUS: Record<string, { label: string; variant: "success" | "warning" | "danger" | "muted" }> = {
  NORMAL: { label: "Normal", variant: "success" },
  ATENCAO: { label: "Atenção", variant: "warning" },
  CRITICO: { label: "Crítico", variant: "danger" },
  SEM_ESTOQUE: { label: "Sem estoque", variant: "muted" },
};

export function StockStatusBadge({ status }: { status: string }) {
  const cfg = STOCK_STATUS[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export const INVENTORY_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "success" | "muted" }> = {
  OPEN: { label: "Aberto", variant: "default" },
  IN_PROGRESS: { label: "Em andamento", variant: "secondary" },
  CONCLUDED: { label: "Concluído", variant: "success" },
  CANCELLED: { label: "Cancelado", variant: "muted" },
};

export function InventoryStatusBadge({ status }: { status: string }) {
  const cfg = INVENTORY_STATUS[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
