/**
 * Requisição de montagem impressa. A folha leva um QR com o link do token; o
 * montador escaneia, abre a página sem login e conclui os cômodos ali — o papel
 * não precisa voltar para a loja.
 */
import crypto from "node:crypto";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../prisma";
import { ROOM_LABEL } from "./productivity.service";

export const newWorkOrderToken = () => crypto.randomBytes(24).toString("base64url");
export const workOrderLink = (token: string) => `${env.appUrl}/os/${token}`;
export const isTokenShape = (t: string) => /^[A-Za-z0-9_-]{24,64}$/.test(t);

export async function nextWorkOrderNumber(organizationId: string) {
  const last = await prisma.installationWorkOrder.findFirst({
    where: { organizationId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = last ? parseInt(last.number.replace(/\D/g, ""), 10) + 1 : 1;
  return `OS-${String(n).padStart(5, "0")}`;
}

export const workOrderInclude = {
  project: {
    select: {
      id: true,
      code: true,
      name: true,
      client: { select: { name: true, phone: true, address: true, street: true, addressNumber: true, complement: true, district: true, city: true, state: true } },
    },
  },
  contractor: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
  tasks: { orderBy: { createdAt: "asc" as const }, select: { id: true, roomType: true, roomLabel: true, status: true, startedAt: true, finishedAt: true, workedMinutes: true, notes: true, review: true } },
} satisfies Prisma.InstallationWorkOrderInclude;

type Row = Prisma.InstallationWorkOrderGetPayload<{ include: typeof workOrderInclude }>;

/** Endereço da obra: o estruturado quando existe, senão o texto antigo. */
export function clientAddress(c: Row["project"]["client"]) {
  const street = [c.street, c.addressNumber].filter(Boolean).join(", ");
  const parts = [street, c.complement, c.district, [c.city, c.state].filter(Boolean).join("/")].filter(Boolean);
  return parts.length ? parts.join(" — ") : c.address ?? null;
}

export function serializeWorkOrder(o: Row, opts: { withToken: boolean }) {
  const tasks = o.tasks.map((t) => ({ ...t, roomTypeLabel: ROOM_LABEL[t.roomType], name: t.roomLabel || ROOM_LABEL[t.roomType] }));
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    scheduledFor: o.scheduledFor,
    instructions: o.instructions,
    receivedByName: o.receivedByName,
    hasClientSignature: Boolean(o.clientSignature),
    clientRating: o.clientRating,
    clientComment: o.clientComment,
    completedAt: o.completedAt,
    createdAt: o.createdAt,
    createdBy: o.createdBy,
    project: { id: o.project.id, code: o.project.code, name: o.project.name },
    client: { name: o.project.client.name, phone: o.project.client.phone, address: clientAddress(o.project.client) },
    contractor: o.contractor,
    tasks,
    progress: { total: tasks.filter((t) => t.status !== "CANCELLED").length, done: tasks.filter((t) => t.status === "DONE").length },
    ...(opts.withToken ? { link: workOrderLink(o.token) } : {}),
  };
}

const brDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "—");

/** Folha A4 para o montador: obra, cômodos, instruções e o QR. */
export async function workOrderPdf(o: Row): Promise<Buffer> {
  const s = serializeWorkOrder(o, { withToken: true });
  const qr = await QRCode.toBuffer(s.link!, { errorCorrectionLevel: "M", margin: 1, width: 360 });
  const org = await prisma.organization.findUnique({ where: { id: o.organizationId }, include: { enterprise: true } });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 44, bottom: 44, left: 48, right: 48 } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const L = 48;
    const W = doc.page.width - 96;

    doc.font("Helvetica").fontSize(9).fillColor("#555").text(org?.enterprise.tradeName ?? org?.enterprise.legalName ?? "", L, 44);
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(17).text(`REQUISIÇÃO DE MONTAGEM ${s.number}`, L, 58, { width: W - 150 });
    doc.font("Helvetica").fontSize(9.5).text(`Emitida em ${brDate(o.createdAt)}${s.scheduledFor ? `   ·   Data prevista ${brDate(s.scheduledFor)}` : ""}`, { width: W - 150 });

    // QR no canto superior direito
    doc.image(qr, L + W - 130, 44, { width: 130 });
    doc.font("Helvetica").fontSize(7.5).fillColor("#555").text("Escaneie para iniciar e concluir os cômodos", L + W - 140, 178, { width: 150, align: "center" }).fillColor("#000");

    doc.y = 110;
    const block = (title: string, lines: (string | null | undefined)[]) => {
      doc.font("Helvetica-Bold").fontSize(10).text(title, L, doc.y, { width: W - 150 });
      doc.font("Helvetica").fontSize(9.5);
      for (const l of lines) if (l) doc.text(l, { width: W - 150 });
      doc.moveDown(0.6);
    };
    block("Montador", [s.contractor.name, s.contractor.phone]);
    block("Obra", [`${s.project.code} — ${s.project.name}`, `Cliente: ${s.client.name}${s.client.phone ? ` · ${s.client.phone}` : ""}`, s.client.address]);

    doc.y = Math.max(doc.y, 200);
    doc.font("Helvetica-Bold").fontSize(11).text("Cômodos", L, doc.y);
    doc.moveDown(0.3);
    for (const t of s.tasks.filter((x) => x.status !== "CANCELLED")) {
      const y = doc.y;
      doc.rect(L, y + 1, 10, 10).lineWidth(0.8).stroke();
      doc.font("Helvetica").fontSize(10.5).text(t.name + (t.roomLabel && t.roomLabel !== t.roomTypeLabel ? `  (${t.roomTypeLabel})` : ""), L + 18, y, { width: W - 18 });
      doc.moveDown(0.5);
    }

    if (s.instructions) {
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(10).text("Instruções", L);
      doc.font("Helvetica").fontSize(9.5).text(s.instructions, { width: W });
    }

    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(10).text("Como concluir", L);
    doc.font("Helvetica").fontSize(9).text(
      "1. Ao chegar, escaneie o QR com a câmera do celular.  2. Toque em Iniciar no cômodo que for montar.  3. Ao terminar, toque em Concluir.  4. No fim, peça ao cliente o nome e a assinatura na própria tela.",
      { width: W }
    );
    doc.fontSize(8).fillColor("#777").text(`Sem câmera? Acesse: ${s.link}`, { width: W }).fillColor("#000");
    doc.end();
  });
}
