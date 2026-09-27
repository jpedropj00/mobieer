/**
 * §55 — Registro central de arquivos. Cada tipo de entidade diz quem pode ver e
 * quem pode anexar; o arquivo herda projeto e cliente da entidade para a busca
 * central. Rota nenhuma confia no entityId vindo do navegador sem passar aqui.
 */
import { prisma } from "../../prisma";
import { projectScope, type ScopeUser } from "../../lib/scope";
import { ForbiddenError, NotFoundError } from "../../utils/ApiError";

export type FileUser = ScopeUser;

type Resolved = { projectId: string | null; clientId: string | null; label: string };

type EntityDef = {
  label: string;
  read: string[]; // basta uma
  write: string[];
  /** Acha a entidade dentro do escopo da pessoa; null = não existe para ela. */
  resolve: (u: FileUser, id: string) => Promise<Resolved | null>;
};

const has = (u: FileUser, codes: string[]) => codes.some((c) => u.permissions.includes(c));

export const FILE_ENTITIES: Record<string, EntityDef> = {
  ProductionStep: {
    label: "Etapa de produção",
    read: ["organization.read"],
    write: ["organization.manage", "production.steps"],
    resolve: async (u, id) => {
      const s = await prisma.productionStep.findFirst({
        where: { id, order: { organizationId: u.organizationId, project: projectScope(u) } },
        select: { step: true, order: { select: { project: { select: { id: true, code: true, clientId: true } } } } },
      });
      return s ? { projectId: s.order.project.id, clientId: s.order.project.clientId, label: `${s.order.project.code} · ${s.step}` } : null;
    },
  },
  Project: {
    label: "Projeto",
    read: ["organization.read"],
    write: ["organization.manage", "documents.manage"],
    resolve: async (u, id) => {
      const p = await prisma.project.findFirst({ where: { id, ...projectScope(u) }, select: { id: true, code: true, clientId: true } });
      return p ? { projectId: p.id, clientId: p.clientId, label: p.code } : null;
    },
  },
};

/** Registra um tipo de entidade (usado pelos módulos que anexam arquivo). */
export function registerFileEntity(name: string, def: EntityDef) {
  FILE_ENTITIES[name] = def;
}

export async function resolveFileEntity(u: FileUser, entity: string, entityId: string, mode: "read" | "write") {
  const def = FILE_ENTITIES[entity];
  if (!def) throw new NotFoundError("Tipo de entidade desconhecido");
  if (!has(u, mode === "read" ? def.read : def.write)) throw new ForbiddenError("Sem permissão para os arquivos deste registro");
  const r = await def.resolve(u, entityId);
  // 404, não 403: não revela que o registro existe
  if (!r) throw new NotFoundError(`${def.label} não encontrado(a)`);
  return r;
}

export function serializeFile(f: {
  id: string;
  entity: string;
  entityId: string;
  category: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  createdBy?: { id: string; name: string } | null;
}) {
  return {
    id: f.id,
    entity: f.entity,
    entityId: f.entityId,
    category: f.category,
    fileName: f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    createdAt: f.createdAt,
    createdBy: f.createdBy ?? null,
    downloadUrl: `/api/files/${f.id}/download`,
  };
}
