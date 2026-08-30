/**
 * Inserções de teste do portal do cliente / documentos.
 * Rode DEPOIS do seed:  npx tsx prisma/test-portal.ts
 * Não limpa nada — apenas cria/atualiza registros de teste.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { storage, buildStorageKey } from "../src/lib/storage";

const prisma = new PrismaClient();
const ORG_ID = "default-org";

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: { name: "ADMIN" } }, select: { id: true } });

  // 1) Ativa a conta do portal já semeada (contrato 364-1) com uma senha de teste.
  const juliana = await prisma.client.findFirst({ where: { name: { contains: "Juliana" } } });
  if (!juliana) throw new Error("Cliente piloto não encontrado — rode o seed antes.");
  const pw = await bcrypt.hash("cliente123", 12);
  const julianaAccount = await prisma.clientAccount.update({
    where: { email: "adv.julianabarboza@gmail.com" },
    data: { passwordHash: pw, status: "ACTIVE", inviteToken: null, inviteExpiry: null },
  });

  // 2) Segundo cliente + projeto + conta de portal INVITED.
  const outro =
    (await prisma.client.findFirst({ where: { name: "Studio Alfa Arquitetura" } })) ??
    (await prisma.client.create({
      data: {
        organizationId: ORG_ID,
        name: "Studio Alfa Arquitetura",
        email: "contato@studioalfa.com.br",
        phone: "(85) 3000-0000",
        status: "ACTIVE",
      },
    }));

  const projetoAlfa = await prisma.project.upsert({
    where: { organizationId_code: { organizationId: ORG_ID, code: "401-2" } },
    update: {},
    create: {
      organizationId: ORG_ID,
      clientId: outro.id,
      code: "401-2",
      name: "Recepção + sala de reunião — Studio Alfa",
      status: "ACTIVE",
      startAt: new Date("2026-08-10"),
      dueAt: new Date("2026-09-05"),
    },
  });

  await prisma.clientAccount.upsert({
    where: { email: "contato@studioalfa.com.br" },
    update: {},
    create: {
      clientId: outro.id,
      name: "Studio Alfa",
      email: "contato@studioalfa.com.br",
      status: "INVITED",
      inviteToken: "dev-invite-studio-alfa",
      inviteExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdById: admin?.id ?? null,
    },
  });

  // 3) Dois documentos no projeto Alfa: um visível e um interno.
  for (const d of [
    { title: "Cronograma preliminar", type: "CRONOGRAMA" as const, visible: true, body: "Etapa 1: recepção (10-20/08)\nEtapa 2: sala de reunião (24/08-05/09)\n" },
    { title: "Medidas internas (uso interno)", type: "OUTRO" as const, visible: false, body: "Rascunho de medidas — não liberar ao cliente.\n" },
  ]) {
    const buf = Buffer.from(d.body, "utf8");
    const fileName = `${d.title.replace(/[^\w]+/g, "_")}.txt`;
    const key = buildStorageKey(projetoAlfa.id, fileName);
    await storage.put(key, buf, "text/plain");
    await prisma.projectDocument.create({
      data: {
        organizationId: ORG_ID,
        projectId: projetoAlfa.id,
        clientId: outro.id,
        type: d.type,
        title: d.title,
        storageKey: key,
        fileName,
        mimeType: "text/plain",
        sizeBytes: buf.byteLength,
        checksum: crypto.createHash("sha256").update(buf).digest("hex"),
        visibleToClient: d.visible,
        uploadedById: admin?.id ?? null,
      },
    });
  }

  // 4) Chamado de assistência aberto "pelo portal" no contrato piloto.
  const projetoJuliana = await prisma.project.findFirst({ where: { code: "364-1" } });
  const count = await prisma.assistanceTicket.count({ where: { organizationId: ORG_ID } });
  const ticket = await prisma.assistanceTicket.create({
    data: {
      number: `AST-${String(count + 1).padStart(5, "0")}`,
      organizationId: ORG_ID,
      clientId: juliana.id,
      projectId: projetoJuliana?.id ?? null,
      title: "Regulagem de porta do módulo guarda-volume",
      description: "Porta inferior direita desalinhou após uma semana de uso.",
      status: "OPEN",
      origin: "CLIENT_PORTAL",
      openedByClientAccountId: julianaAccount.id,
    },
  });

  // Resumo
  const summary = {
    portalLoginAtivo: { email: "adv.julianabarboza@gmail.com", senha: "cliente123" },
    conviteInvitePendente: "/portal/definir-senha?token=dev-invite-studio-alfa",
    clientes: await prisma.client.count(),
    projetos: await prisma.project.count(),
    documentos: await prisma.projectDocument.count(),
    documentosVisiveis: await prisma.projectDocument.count({ where: { visibleToClient: true } }),
    contasPortal: await prisma.clientAccount.count(),
    chamados: await prisma.assistanceTicket.count(),
    ultimoChamado: { number: ticket.number, origin: ticket.origin },
  };
  console.log("[TEST-PORTAL] OK\n" + JSON.stringify(summary, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
