/**
 * Avisos de erro para quem administra o sistema (permissão de auditoria) e a
 * checagem de saúde usada por monitores de disponibilidade.
 */
import { whereHasPermission } from "./user-roles";
import { env } from "../config/env";
import { prisma } from "../prisma";
import { clientAlertText, newAlertStore, routeKey, serverAlertText, shouldAlert } from "./monitoring.rules";

const store = newAlertStore();

async function notifyAdmins(organizationId: string | null | undefined, title: string, message: string) {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", ...(organizationId ? { organizationId } : {}), ...whereHasPermission("audit.read") },
    select: { id: true },
    take: 50,
  });
  if (!users.length) return;
  await prisma.notification.createMany({ data: users.map((u) => ({ type: "INFO" as const, title, message, userId: u.id })) });
}

/** Erro 5xx no backend. Nunca lança: monitorar não pode piorar o erro original. */
export async function reportServerError(e: { method: string; url: string; code?: string | null; errorId?: string | null; organizationId?: string | null }) {
  try {
    const key = routeKey(e.method, e.url);
    // o próprio monitoramento e a checagem de saúde não geram aviso em cadeia
    if (/\/(monitoring|health)\b/.test(key)) return;
    if (!shouldAlert(store, key)) return;
    const t = serverAlertText({ key, errorId: e.errorId, code: e.code });
    await notifyAdmins(e.organizationId, t.title, t.message);
  } catch {
    /* sem banco não há como avisar; o erro já está no log */
  }
}

/** Erro que aconteceu no navegador de alguém (tela quebrada). */
export async function reportClientError(e: { message: string; path: string; organizationId?: string | null }) {
  try {
    const t = clientAlertText(e);
    console.error(`[CLIENT_ERROR] ${t.message}`);
    if (!shouldAlert(store, t.key)) return;
    await notifyAdmins(e.organizationId, t.title, t.message);
  } catch {
    /* idem */
  }
}

/** Saúde de verdade: a API responde e o banco também. */
export async function healthCheck() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, database: "ok", ms: Date.now() - started, assistant: Boolean(env.ai.apiKey || env.assistant.apiKey) ? "configurado" : "sem chave" };
  } catch {
    return { ok: false, database: "fora do ar", ms: Date.now() - started };
  }
}
