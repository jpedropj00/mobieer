/**
 * Alerta de vencimento dos documentos financeiros.
 *
 * Roda uma vez por dia (Vercel Cron → /api/cron/daily). Avisa quem precisa ver:
 * o responsável pelo documento e quem tem permissão de financeiro.
 *
 * O status em si NÃO é gravado aqui — "vencido" e "próximo do vencimento" são
 * derivados na leitura (documents.service.ts), então a tela está certa mesmo se
 * este job atrasar ou não rodar. O job só existe para avisar.
 */
import { FinanceStatus, NotificationType } from "@prisma/client";
import { prisma } from "../../prisma";
import { DEFAULT_ALERT_DAYS, daysUntilDue, localDay, normalizeAlertDays, remainingBalance } from "./documents.service";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Uma notificação por documento por dia: o job pode rodar de novo sem duplicar. */
async function alreadyNotified(entityId: string, day: string) {
  const found = await prisma.notification.findFirst({
    where: { entity: "FinanceTransaction", entityId, message: { contains: `#${day}` } },
    select: { id: true },
  });
  return Boolean(found);
}

export async function runFinanceDueAlerts(now = new Date()) {
  const setting = await prisma.setting.findUnique({ where: { key: "financeAlertDays" } });
  const defaultDays = normalizeAlertDays(setting?.value, DEFAULT_ALERT_DAYS);
  const today = localDay(now);

  // só o que está em aberto e tem vencimento; a janela larga evita varrer a tabela toda
  const docs = await prisma.financeTransaction.findMany({
    where: {
      status: { in: [FinanceStatus.PENDENTE, FinanceStatus.PARCIAL] },
      dueDate: { not: null, lte: new Date(now.getTime() + 15 * 86400000) },
    },
    select: {
      id: true, organizationId: true, category: true, docType: true, docNumber: true,
      amount: true, paidAmount: true, dueDate: true, alertDays: true, responsibleId: true,
      supplier: { select: { name: true } },
    },
  });

  let vencidos = 0;
  let aVencer = 0;
  let notificados = 0;

  for (const d of docs) {
    const days = daysUntilDue(d.dueDate!, now);
    const alertDays = normalizeAlertDays(d.alertDays, defaultDays);
    const overdue = days < 0;
    if (!overdue && days > alertDays) continue;

    if (overdue) vencidos++;
    else aVencer++;

    if (await alreadyNotified(d.id, today)) continue;

    const saldo = remainingBalance(Number(d.amount), Number(d.paidAmount));
    const quem = d.supplier?.name ? ` · ${d.supplier.name}` : "";
    const titulo = overdue
      ? `Documento vencido há ${Math.abs(days)} dia(s)`
      : days === 0
        ? "Documento vence hoje"
        : `Documento vence em ${days} dia(s)`;
    const texto = `${d.docType}${d.docNumber ? ` ${d.docNumber}` : ""} · ${d.category}${quem} · ${brl(saldo)} #${today}`;

    // responsável pelo documento + quem cuida do financeiro, sem repetir ninguém
    const financeiro = await prisma.user.findMany({
      where: {
        organizationId: d.organizationId,
        status: "ACTIVE",
        role: { permissions: { some: { permission: { code: { in: ["finance.documents.read", "finance.read"] } } } } },
      },
      select: { id: true },
    });
    const destinatarios = new Set<string>([...financeiro.map((u) => u.id), ...(d.responsibleId ? [d.responsibleId] : [])]);
    if (!destinatarios.size) continue;

    await prisma.notification.createMany({
      data: [...destinatarios].map((userId) => ({
        userId,
        type: overdue ? NotificationType.FINANCE_OVERDUE : NotificationType.FINANCE_DUE,
        title: titulo,
        message: texto,
        entity: "FinanceTransaction",
        entityId: d.id,
        link: `/financeiro/documentos/${d.id}`,
      })),
    });
    notificados++;
  }

  return { inspecionados: docs.length, vencidos, aVencer, notificados };
}
