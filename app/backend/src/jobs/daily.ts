/**
 * Rotinas diárias. Em produção (Vercel, serverless) não existe processo vivo
 * para `setInterval`: quem dispara é o Vercel Cron chamando /api/cron/daily.
 * Em desenvolvimento, o server.ts roda a mesma lista ao subir e a cada 24h.
 *
 * Cada rotina roda isolada: a falha de uma não impede as outras.
 */
import { sendAutomation, getAutomation } from "../lib/automations";
import { prisma } from "../prisma";
import { runAssistanceReminders } from "../modules/assistance/assistance.service";
import { runCommercialFollowupAlerts } from "../modules/commercial/commercial.service";
import { runHolidayNotices } from "../modules/hr/holidays.service";
import { runVacationAlerts } from "../modules/hr/hr.service";
import { runMeasurementDeadlineAlerts } from "../modules/measurements/measurements.service";
import { runProductionDeliveryAlerts } from "../modules/production/production.service";
import { runFinanceDueAlerts } from "../modules/finance/alerts.service";

const DAY_MS = 86400000;

/** Pós-venda: X dias depois da entrega, pergunta ao cliente como ficou. */
export async function runPostSaleFollowups(now = new Date()) {
  const orders = await prisma.productionOrder.findMany({
    where: { stage: "DELIVERED", deliveredAt: { not: null, gte: new Date(now.getTime() - 60 * DAY_MS) } },
    select: { id: true, organizationId: true, deliveredAt: true, project: { select: { code: true, name: true, clientId: true } } },
  });
  let sent = 0;
  const delayByOrg = new Map<string, number>();
  for (const o of orders) {
    if (!delayByOrg.has(o.organizationId)) {
      delayByOrg.set(o.organizationId, (await getAutomation(o.organizationId, "POST_SALE_FOLLOWUP")).delayDays);
    }
    const delay = delayByOrg.get(o.organizationId)!;
    const days = Math.floor((now.getTime() - o.deliveredAt!.getTime()) / DAY_MS);
    // janela de 3 dias: se o cron falhar um dia, ainda envia
    if (days < delay || days > delay + 3) continue;
    const r = await sendAutomation("POST_SALE_FOLLOWUP", {
      organizationId: o.organizationId,
      clientId: o.project.clientId,
      vars: { "projeto.codigo": o.project.code, "projeto.nome": o.project.name },
      dedupeKey: `post-sale:${o.id}`,
    });
    if (r.status === "SENT" || r.status === "LOGGED") sent++;
  }
  return { sent };
}

export const DAILY_JOBS: { name: string; run: () => Promise<unknown> }[] = [
  { name: "ferias", run: runVacationAlerts },
  { name: "comercial-followup", run: runCommercialFollowupAlerts },
  { name: "prazo-projeto-tecnico", run: runMeasurementDeadlineAlerts },
  { name: "entrega-producao", run: runProductionDeliveryAlerts },
  { name: "feriados", run: () => runHolidayNotices() },
  { name: "assistencia-lembretes", run: () => runAssistanceReminders() },
  { name: "pos-venda", run: () => runPostSaleFollowups() },
  { name: "financeiro-vencimentos", run: () => runFinanceDueAlerts() },
];

export async function runDailyJobs() {
  const results: { job: string; ok: boolean; ms: number; result?: unknown; error?: string }[] = [];
  for (const job of DAILY_JOBS) {
    const started = Date.now();
    try {
      const result = await job.run();
      results.push({ job: job.name, ok: true, ms: Date.now() - started, result });
    } catch (e) {
      console.error(`[cron] ${job.name} falhou:`, e);
      results.push({ job: job.name, ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
