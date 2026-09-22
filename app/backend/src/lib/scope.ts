/**
 * Escopo por posse do registro: quem pode ver qual cliente e qual projeto.
 *
 * A permissão diz *o que* a pessoa pode fazer; o escopo diz *sobre quais
 * registros*. Esconder botão no frontend não protege nada — toda rota que
 * lista ou abre cliente/projeto passa por aqui no servidor.
 *
 * - `clients.read.all`: vê todos os clientes da organização (todos os perfis
 *   que já existiam receberam esta permissão, então para eles nada muda).
 * - sem ela (CONSULTOR): só a carteira própria — clientes em que é o
 *   consultor que vendeu ou o responsável pelo atendimento.
 * - montador: só os projetos em que tem cômodo atribuído.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { ForbiddenError, NotFoundError } from "../utils/ApiError";

export type ScopeUser = { id: string; organizationId: string; permissions: string[] };

const has = (u: ScopeUser, code: string) => u.permissions.includes(code);

/** Montador puro: acessa pela área dele, sem enxergar a carteira da loja. */
export const isContractorOnly = (u: ScopeUser) => has(u, "contractors.self") && !has(u, "organization.read");

/** Filtro de clientes que a pessoa pode ver. */
export function clientScope(u: ScopeUser): Prisma.ClientWhereInput {
  const base: Prisma.ClientWhereInput = { organizationId: u.organizationId };
  if (has(u, "clients.read.all")) return base;
  if (isContractorOnly(u)) {
    return { ...base, projects: { some: { installationTasks: { some: { contractor: { userId: u.id } } } } } };
  }
  return { ...base, OR: [{ sellerId: u.id }, { attendantId: u.id }] };
}

/** Filtro de projetos que a pessoa pode ver. */
export function projectScope(u: ScopeUser): Prisma.ProjectWhereInput {
  const base: Prisma.ProjectWhereInput = { organizationId: u.organizationId };
  if (has(u, "clients.read.all")) return base;
  if (isContractorOnly(u)) {
    return { ...base, installationTasks: { some: { contractor: { userId: u.id, active: true } } } };
  }
  return {
    ...base,
    OR: [{ client: { sellerId: u.id } }, { client: { attendantId: u.id } }, { managerId: u.id }],
  };
}

/**
 * Garante que o projeto existe e está no escopo da pessoa. Projeto de outra
 * organização vira 404 (não confirma que existe); da mesma organização, mas
 * fora da carteira, vira 403.
 */
export async function assertProjectAccess(projectId: string, u: ScopeUser) {
  const inScope = await prisma.project.findFirst({ where: { id: projectId, ...projectScope(u) }, select: { id: true } });
  if (inScope) return inScope;
  const exists = await prisma.project.findFirst({ where: { id: projectId, organizationId: u.organizationId }, select: { id: true } });
  if (!exists) throw new NotFoundError("Projeto não encontrado");
  throw new ForbiddenError("Este projeto não está na sua carteira");
}

export async function assertClientAccess(clientId: string, u: ScopeUser) {
  const inScope = await prisma.client.findFirst({ where: { id: clientId, ...clientScope(u) }, select: { id: true } });
  if (inScope) return inScope;
  const exists = await prisma.client.findFirst({ where: { id: clientId, organizationId: u.organizationId }, select: { id: true } });
  if (!exists) throw new NotFoundError("Cliente não encontrado");
  throw new ForbiddenError("Este cliente não está na sua carteira");
}
