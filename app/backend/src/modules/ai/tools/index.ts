/**
 * Ferramentas do Mobieer AI, no formato do MCP (nome, descrição, esquema de
 * entrada, retorno definido). O modelo só enxerga estas funções — não existe
 * SQL livre. Toda ferramenta recebe o usuário do token (nunca um id vindo do
 * modelo), confere a permissão e filtra pelo mesmo escopo das telas.
 */
import { z } from "zod";
import { prisma } from "../../../prisma";
import { projectScope, type ScopeUser } from "../../../lib/scope";
import { myTasksWhere } from "../../organization/my-tasks.rules";
import type { ToolCall, ToolDeclaration } from "../provider";

export type ToolUser = ScopeUser & { name: string; email: string; roleLabel: string; sector: string | null };

type Tool<I> = {
  name: string;
  description: string;
  /** Permissão exigida, a mesma da tela correspondente. */
  permission?: string;
  inputSchema: Record<string, unknown>;
  input: z.ZodType<I>;
  run: (user: ToolUser, input: I) => Promise<unknown>;
};

export class ToolError extends Error {}

const PROJECT_STATUS: Record<string, string> = { PLANNING: "Em planejamento", ACTIVE: "Em andamento", ON_HOLD: "Pausado", COMPLETED: "Concluído", CANCELLED: "Cancelado" };
const PRODUCTION_STAGE: Record<string, string> = { RELEASED: "Liberado para produção", IN_PRODUCTION: "Em produção", PRE_ASSEMBLY: "Pré-montagem", OUT_FOR_DELIVERY: "Em rota de entrega e montagem", DELIVERED: "Entregue e montado" };
const PRIORITY: Record<string, string> = { LOW: "Baixa", NORMAL: "Normal", HIGH: "Alta", URGENT: "Urgente" };
const TECH_APPROVAL: Record<string, string> = { DRAFT: "Em preparação pela equipe", IN_REVIEW: "Aguardando o cliente", APPROVED: "Aprovado pelo cliente", CHANGES_REQUESTED: "Cliente pediu ajustes" };
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const MAX_ROWS = 20;

const noInput = z.object({}).passthrough();

function define<I>(t: Tool<I>): Tool<unknown> {
  return t as unknown as Tool<unknown>;
}

const TOOLS: Tool<unknown>[] = [
  define({
    name: "get_user_profile",
    description: "Dados do usuário que está conversando: nome, e-mail, perfil e setor.",
    inputSchema: { type: "object", properties: {} },
    input: noInput,
    run: async (u) => ({ name: u.name, email: u.email, role: u.roleLabel, sector: u.sector }),
  }),
  define({
    name: "get_user_projects",
    description: "Projetos que o usuário pode ver no Mobieer (a carteira dele, ou todos se o perfil permitir), com total por situação. Use para 'quantos projetos eu tenho', 'quais são meus projetos'.",
    permission: "organization.read",
    inputSchema: { type: "object", properties: { status: { type: ["string", "null"], enum: [...Object.keys(PROJECT_STATUS), null], description: "Filtra por situação; omita ou mande null para todas" } } },
    // alguns modelos mandam null no parâmetro opcional
    input: z.object({ status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]).nullish() }),
    run: async (u, i) => {
      const where = { ...projectScope(u), ...(i.status ? { status: i.status } : {}) };
      const [total, byStatus, rows] = await Promise.all([
        prisma.project.count({ where }),
        prisma.project.groupBy({ by: ["status"], where, _count: { _all: true } }),
        prisma.project.findMany({ where, orderBy: { updatedAt: "desc" }, take: MAX_ROWS, select: { code: true, name: true, status: true, dueAt: true, client: { select: { name: true } } } }),
      ]);
      return {
        total,
        by_status: byStatus.map((s) => ({ status: PROJECT_STATUS[s.status] ?? s.status, count: s._count._all })),
        projects: rows.map((p) => ({ code: p.code, name: p.name, client: p.client.name, status: PROJECT_STATUS[p.status] ?? p.status, due_date: day(p.dueAt) })),
        truncated: total > rows.length,
      };
    },
  }),
  define({
    name: "search_projects",
    description: "Procura projetos pelo código, nome do projeto ou nome do cliente.",
    permission: "organization.read",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Código, nome do projeto ou do cliente" } }, required: ["query"] },
    input: z.object({ query: z.string().trim().min(2).max(80) }),
    run: async (u, i) => {
      const q = { contains: i.query, mode: "insensitive" as const };
      const rows = await prisma.project.findMany({
        where: { AND: [projectScope(u), { OR: [{ code: q }, { name: q }, { client: { name: q } }] }] },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { code: true, name: true, status: true, client: { select: { name: true } } },
      });
      return { projects: rows.map((p) => ({ code: p.code, name: p.name, client: p.client.name, status: PROJECT_STATUS[p.status] ?? p.status })) };
    },
  }),
  define({
    name: "get_project_status",
    description: "Situação de um projeto pelo código: situação geral, prazo, etapa da produção e quantidade de documentos e assistências.",
    permission: "organization.read",
    inputSchema: { type: "object", properties: { code: { type: "string", description: "Código do projeto, como aparece em Clientes e projetos (ex.: 402-1)" } }, required: ["code"] },
    input: z.object({ code: z.string().trim().min(1).max(40) }),
    run: async (u, i) => {
      const p = await prisma.project.findFirst({
        where: { AND: [projectScope(u), { code: { equals: i.code, mode: "insensitive" } }] },
        select: {
          code: true, name: true, status: true, startAt: true, dueAt: true, completedAt: true,
          client: { select: { name: true } },
          manager: { select: { name: true } },
          productionOrder: { select: { stage: true } },
          technicalApproval: { select: { status: true } },
          _count: { select: { documents: true, assistances: true } },
        },
      });
      // fora da carteira e inexistente dão a mesma resposta: não confirma que o projeto existe
      if (!p) throw new ToolError("Projeto não encontrado entre os que você pode ver.");
      return {
        code: p.code,
        name: p.name,
        client: p.client.name,
        manager: p.manager?.name ?? null,
        status: PROJECT_STATUS[p.status] ?? p.status,
        start_date: day(p.startAt),
        due_date: day(p.dueAt),
        completed_date: day(p.completedAt),
        production_stage: p.productionOrder ? PRODUCTION_STAGE[p.productionOrder.stage] ?? p.productionOrder.stage : "Ainda não liberado para produção",
        technical_approval: p.technicalApproval ? TECH_APPROVAL[p.technicalApproval.status] ?? p.technicalApproval.status : "Ainda não iniciada",
        documents: p._count.documents,
        assistance_tickets: p._count.assistances,
      };
    },
  }),
  define({
    name: "get_my_tasks",
    description: "Tarefas em aberto do usuário na Organização interna (as mesmas da tela Minhas tarefas), com prazo e atraso.",
    permission: "organization.read",
    inputSchema: { type: "object", properties: {} },
    input: noInput,
    run: async (u) => {
      const where = { AND: [myTasksWhere(u.id), { completedAt: null }] };
      const [total, rows] = await Promise.all([
        prisma.kanbanTask.count({ where }),
        prisma.kanbanTask.findMany({ where, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }], take: MAX_ROWS, select: { title: true, dueAt: true, priority: true, column: { select: { name: true } }, project: { select: { code: true } } } }),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      return {
        total,
        tasks: rows.map((t) => ({ title: t.title, column: t.column.name, priority: PRIORITY[t.priority] ?? t.priority, due_date: day(t.dueAt), overdue: Boolean(t.dueAt && day(t.dueAt)! < today), project: t.project?.code ?? null })),
        truncated: total > rows.length,
      };
    },
  }),
];

/** Só as ferramentas que o perfil do usuário pode usar chegam ao modelo. */
export function toolsFor(user: ToolUser): ToolDeclaration[] {
  return TOOLS.filter((t) => !t.permission || user.permissions.includes(t.permission)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

export async function executeTool(user: ToolUser, call: ToolCall): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === call.name);
  if (!tool) throw new ToolError("Ferramenta desconhecida.");
  // confere de novo aqui: o modelo não decide o que o usuário pode ver
  if (tool.permission && !user.permissions.includes(tool.permission)) throw new ToolError("O seu perfil não tem acesso a essa informação.");
  const parsed = tool.input.safeParse(call.args ?? {});
  if (!parsed.success) throw new ToolError("Parâmetros inválidos para a ferramenta.");
  return tool.run(user, parsed.data);
}

export const TOOL_NAMES = TOOLS.map((t) => t.name);
