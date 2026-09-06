import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";

/** Categorias e itens padrão da Ficha de Eletrodomésticos (docs/Ficha_Eletrodomesticos_Mobieer_Final.pdf). */
export const APPLIANCE_CATEGORIES = ["COZINHA", "GOURMET", "LAVANDERIA", "OUTROS"] as const;
export type ApplianceCategory = (typeof APPLIANCE_CATEGORIES)[number];

export const APPLIANCE_CATEGORY_LABELS: Record<ApplianceCategory, string> = {
  COZINHA: "Cozinha",
  GOURMET: "Cozinha e área gourmet",
  LAVANDERIA: "Lavanderia",
  OUTROS: "Outros ambientes",
};

export const DEFAULT_APPLIANCE_ITEMS: { category: ApplianceCategory; name: string }[] = [
  { category: "COZINHA", name: "Geladeira / refrigerador" },
  { category: "COZINHA", name: "Cooktop" },
  { category: "COZINHA", name: "Forno elétrico ou a gás" },
  { category: "COZINHA", name: "Micro-ondas" },
  { category: "COZINHA", name: "Coifa / depurador" },
  { category: "GOURMET", name: "Lava-louças" },
  { category: "GOURMET", name: "Adega" },
  { category: "GOURMET", name: "Cervejeira" },
  { category: "GOURMET", name: "Frigobar" },
  { category: "GOURMET", name: "Forno de pizza / churrasqueira" },
  { category: "LAVANDERIA", name: "Máquina de lavar" },
  { category: "LAVANDERIA", name: "Secadora" },
  { category: "LAVANDERIA", name: "Tanquinho" },
  { category: "OUTROS", name: "TV 1" },
  { category: "OUTROS", name: "TV 2" },
  { category: "OUTROS", name: "TV 3" },
];

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));

export function serializeItem(i: {
  id: string; category: string; name: string; owned: boolean; willBuy: boolean;
  brandModel: string | null; widthCm: Prisma.Decimal | null; heightCm: Prisma.Decimal | null;
  depthCm: Prisma.Decimal | null; referenceUrl: string | null; notes: string | null; custom: boolean; position: number;
}) {
  return {
    id: i.id,
    category: i.category,
    name: i.name,
    owned: i.owned,
    willBuy: i.willBuy,
    brandModel: i.brandModel,
    widthCm: num(i.widthCm),
    heightCm: num(i.heightCm),
    depthCm: num(i.depthCm),
    referenceUrl: i.referenceUrl,
    notes: i.notes,
    custom: i.custom,
    position: i.position,
  };
}

/**
 * Busca a ficha do projeto criando-a (com os itens padrão) na primeira vez.
 * Usada tanto pelo app interno quanto pelo portal do cliente.
 */
export async function getOrCreateSheet(projectId: string, organizationId: string) {
  const existing = await prisma.applianceSheet.findUnique({
    where: { projectId },
    include: { items: { orderBy: [{ position: "asc" }, { name: "asc" }] }, reviewedBy: { select: { id: true, name: true } } },
  });
  if (existing) return existing;

  await prisma.applianceSheet.create({
    data: {
      organizationId,
      projectId,
      items: {
        create: DEFAULT_APPLIANCE_ITEMS.map((it, idx) => ({ category: it.category, name: it.name, position: idx })),
      },
    },
  });
  return prisma.applianceSheet.findUniqueOrThrow({
    where: { projectId },
    include: { items: { orderBy: [{ position: "asc" }, { name: "asc" }] }, reviewedBy: { select: { id: true, name: true } } },
  });
}

export function serializeSheet(sheet: {
  id: string; status: string; projetista: string | null; ambientes: string | null; notes: string | null;
  submittedAt: Date | null; reviewedAt: Date | null; updatedAt: Date;
  reviewedBy?: { id: string; name: string } | null;
  items: Parameters<typeof serializeItem>[0][];
  project?: { id: string; code: string; name: string; client?: { name: string } | null } | null;
}) {
  return {
    id: sheet.id,
    status: sheet.status,
    projetista: sheet.projetista,
    ambientes: sheet.ambientes,
    notes: sheet.notes,
    submittedAt: sheet.submittedAt,
    reviewedAt: sheet.reviewedAt,
    reviewedBy: sheet.reviewedBy ?? null,
    updatedAt: sheet.updatedAt,
    project: sheet.project
      ? { id: sheet.project.id, code: sheet.project.code, name: sheet.project.name, clientName: sheet.project.client?.name ?? null }
      : undefined,
    items: [...sheet.items].map(serializeItem),
  };
}
