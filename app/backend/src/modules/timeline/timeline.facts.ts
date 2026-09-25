/**
 * Junta, de cada módulo, o que o sistema já sabe sobre um projeto — para a
 * timeline nascer (e se manter) a partir dos dados reais, sem ninguém
 * precisar digitar de novo o que já foi registrado em outro lugar.
 */
import { prisma } from "../../prisma";
import type { TimelineFacts } from "./timeline.service";

export async function loadTimelineFacts(projectId: string): Promise<TimelineFacts | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      clientId: true,
      status: true,
      createdAt: true,
      measurementVisits: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true, doneAt: true } },
      technicalApproval: { select: { status: true, publishedAt: true, approvedAt: true } },
      productionOrder: {
        select: { stage: true, releasedAt: true, preAssemblyAt: true, outForDeliveryAt: true, deliveredAt: true },
      },
      installationTasks: { select: { status: true, startedAt: true, finishedAt: true } },
      assistances: { select: { status: true, createdAt: true } },
      siteInspections: { where: { status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 1, select: { inspectedAt: true } },
      warranty: { select: { endsAt: true } },
      // o pedido ligado ao projeto é o elo mais direto com o comercial
      salesOrders: {
        orderBy: { orderedAt: "asc" },
        take: 1,
        select: {
          orderedAt: true,
          opportunity: {
            select: {
              wonAt: true,
              lead: { select: { createdAt: true, briefing: { select: { createdAt: true } } } },
              quotes: { orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
            },
          },
        },
      },
      documents: {
        where: { type: "CONTRATO" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, signatureStatus: true, signatures: { select: { signedAt: true } } },
      },
      financeTransactions: {
        where: { type: "RECEITA", status: { in: ["PAGO", "PARCIAL"] } },
        orderBy: { paidAt: "asc" },
        take: 1,
        select: { paidAt: true, date: true },
      },
    },
  });
  if (!project) return null;

  // Sem pedido ligado ao projeto, o comercial vem do cliente (o mais recente).
  const order = project.salesOrders[0];
  let opportunity = order?.opportunity ?? null;
  if (!opportunity) {
    opportunity = await prisma.commercialOpportunity.findFirst({
      where: { clientId: project.clientId },
      orderBy: [{ wonAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: {
        wonAt: true,
        lead: { select: { createdAt: true, briefing: { select: { createdAt: true } } } },
        quotes: { orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
      },
    });
  }
  const lead =
    opportunity?.lead ??
    (await prisma.commercialLead.findFirst({
      where: { convertedClientId: project.clientId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, briefing: { select: { createdAt: true } } },
    }));

  const signedContract = project.documents.find((d) => d.signatureStatus === "SIGNED");
  const signedAt = signedContract?.signatures.map((s) => s.signedAt).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];

  const tasks = project.installationTasks.filter((t) => t.status !== "CANCELLED");
  const started = tasks.map((t) => t.startedAt).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const finished = tasks.map((t) => t.finishedAt).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const openAssistance = project.assistances.filter((a) => !["RESOLVED", "CANCELLED"].includes(a.status));
  const lastOpened = project.assistances.map((a) => a.createdAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const measurement = project.measurementVisits[0] ?? null;
  const payment = project.financeTransactions[0];

  return {
    projectCreatedAt: project.createdAt,
    projectStatus: project.status,
    leadAt: lead?.createdAt ?? null,
    briefingAt: lead?.briefing?.createdAt ?? null,
    quoteAt: opportunity?.quotes[0]?.createdAt ?? null,
    wonAt: opportunity?.wonAt ?? null,
    // assinatura com data > documento marcado como assinado > nada
    contractSignedAt: signedAt ?? (signedContract ? signedContract.createdAt : null),
    contractSentAt: project.documents[0]?.createdAt ?? null,
    entryPaidAt: payment ? payment.paidAt ?? payment.date : null,
    measurement: measurement ? { status: measurement.status, createdAt: measurement.createdAt, doneAt: measurement.doneAt } : null,
    techApproval: project.technicalApproval,
    production: project.productionOrder,
    installation: tasks.length ? { startedAt: started, finishedAt: finished, allDone: tasks.every((t) => t.status === "DONE") } : null,
    inspectionDoneAt: project.siteInspections[0]?.inspectedAt ?? null,
    warrantyEndsAt: project.warranty?.endsAt ?? null,
    assistance: project.assistances.length
      ? { open: openAssistance.length, total: project.assistances.length, lastOpenedAt: lastOpened }
      : null,
  };
}
