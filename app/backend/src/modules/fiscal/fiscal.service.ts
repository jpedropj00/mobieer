import { Prisma } from "@prisma/client";

export const fiscalInclude = {
  project: { select: { id: true, code: true, name: true } },
  client: { select: { id: true, name: true, document: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

type InvoiceRow = {
  id: string;
  kind: string;
  status: string;
  ref: string;
  provider: string | null;
  providerRef: string | null;
  number: string | null;
  series: string | null;
  amount: Prisma.Decimal | number | string;
  description: string | null;
  resultJson: unknown;
  xmlKey: string | null;
  pdfKey: string | null;
  errorMessage: string | null;
  issuedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  project?: { id: string; code: string; name: string } | null;
  client?: { id: string; name: string; document: string | null } | null;
  createdBy?: { id: string; name: string } | null;
};

export function serializeInvoice(i: InvoiceRow) {
  return {
    id: i.id,
    kind: i.kind,
    status: i.status,
    ref: i.ref,
    provider: i.provider,
    providerRef: i.providerRef,
    number: i.number,
    series: i.series,
    amount: Number(i.amount),
    description: i.description,
    xmlUrl: i.xmlKey ? `/api/fiscal/${i.id}/file/xml` : null,
    pdfUrl: i.pdfKey ? `/api/fiscal/${i.id}/file/pdf` : null,
    errorMessage: i.errorMessage,
    issuedAt: i.issuedAt,
    cancelledAt: i.cancelledAt,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    project: i.project ?? null,
    client: i.client ?? null,
    createdBy: i.createdBy ?? null,
  };
}

/** Referência idempotente enviada ao provedor (única por organização). */
export function buildInvoiceRef(orgId: string) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `MOB-${orgId.slice(0, 6)}-${Date.now().toString(36)}-${rand}`.toUpperCase();
}
