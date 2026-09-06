import { prisma } from "../../prisma";

export const DEFAULT_TERM_TEXT =
  "Declaro que revisei o projeto técnico apresentado — medidas, layout, acabamentos e especificações — e APROVO a sua execução. " +
  "Estou ciente de que, após esta aprovação, quaisquer alterações no projeto poderão gerar custo adicional e novo prazo de produção e entrega.";

type ApprovalRow = {
  id: string;
  status: string;
  termText: string | null;
  documentId: string | null;
  publishedAt: Date | null;
  approvedAt: Date | null;
  approvedByName: string | null;
  signatureDataUrl: string | null;
  clientComment: string | null;
  reviewRound: number;
  createdAt: Date;
  updatedAt: Date;
  publishedBy?: { id: string; name: string } | null;
  document?: {
    id: string;
    title: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    visibleToClient: boolean;
  } | null;
  project?: { id: string; code: string; name: string; client?: { name: string } | null; managerId: string | null } | null;
};

export function serializeApproval(a: ApprovalRow, opts: { includeSignature?: boolean } = {}) {
  return {
    id: a.id,
    status: a.status,
    termText: a.termText ?? DEFAULT_TERM_TEXT,
    reviewRound: a.reviewRound,
    publishedAt: a.publishedAt,
    publishedBy: a.publishedBy ?? null,
    approvedAt: a.approvedAt,
    approvedByName: a.approvedByName,
    hasSignature: Boolean(a.signatureDataUrl),
    signatureDataUrl: opts.includeSignature ? a.signatureDataUrl ?? null : undefined,
    clientComment: a.clientComment,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    document: a.document
      ? {
          id: a.document.id,
          title: a.document.title,
          fileName: a.document.fileName,
          mimeType: a.document.mimeType,
          sizeBytes: a.document.sizeBytes,
          visibleToClient: a.document.visibleToClient,
        }
      : null,
    project: a.project
      ? { id: a.project.id, code: a.project.code, name: a.project.name, clientName: a.project.client?.name ?? null }
      : undefined,
  };
}

export const approvalInclude = {
  publishedBy: { select: { id: true, name: true } },
  document: { select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, visibleToClient: true } },
  project: { select: { id: true, code: true, name: true, managerId: true, client: { select: { name: true } } } },
} as const;

export async function getOrCreateApproval(projectId: string, organizationId: string) {
  const existing = await prisma.technicalProjectApproval.findUnique({ where: { projectId }, include: approvalInclude });
  if (existing) return existing;
  await prisma.technicalProjectApproval.create({
    data: { organizationId, projectId, termText: DEFAULT_TERM_TEXT },
  });
  return prisma.technicalProjectApproval.findUniqueOrThrow({ where: { projectId }, include: approvalInclude });
}
