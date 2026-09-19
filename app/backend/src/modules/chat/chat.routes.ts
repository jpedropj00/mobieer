import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { uploadDocument } from "../../middlewares/upload";
import { storage, buildStorageKey } from "../../lib/storage";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ForbiddenError, NotFoundError, ValidationError } from "../../utils/ApiError";
import { dateQuery, intQuery } from "../../utils/query";
import { ok } from "../../utils/response";
import { pipeToResponse } from "../../utils/stream";
import { canDeleteMessage, channelsFor, ensureScopedChannel, loadChannelFor, syncDefaultMemberships, unreadByChannel } from "./chat.service";

/** /api/chat — dois canais: "Equipe" e "Equipe + montadores" */
const router = Router();
router.use(authenticate, requirePermission("chat.use"));

const authorSelect = { select: { id: true, name: true, imageUrl: true, role: { select: { name: true } } } } as const;

/** Prévia da mensagem respondida: o bastante para a tela mostrar a citação. */
const replyToSelect = {
  select: { id: true, body: true, fileName: true, deletedAt: true, author: { select: { id: true, name: true } } },
} as const;

const serializeMessage = (m: {
  id: string;
  channelId: string;
  body: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  storageKey: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  replyToId?: string | null;
  replyTo?: {
    id: string;
    body: string;
    fileName: string | null;
    deletedAt: Date | null;
    author: { id: string; name: string } | null;
  } | null;
  author: { id: string; name: string; imageUrl: string | null; role: { name: string } } | null;
}) => ({
  id: m.id,
  channelId: m.channelId,
  body: m.deletedAt ? "" : m.body,
  deleted: Boolean(m.deletedAt),
  createdAt: m.createdAt,
  editedAt: m.editedAt,
  replyTo: m.replyTo
    ? {
        id: m.replyTo.id,
        // a prévia da resposta some junto quando a original é apagada
        body: m.replyTo.deletedAt ? "" : m.replyTo.body || (m.replyTo.fileName ? `📎 ${m.replyTo.fileName}` : ""),
        deleted: Boolean(m.replyTo.deletedAt),
        authorName: m.replyTo.author?.name ?? null,
      }
    : null,
  author: m.author ? { id: m.author.id, name: m.author.name, imageUrl: m.author.imageUrl, isContractor: m.author.role.name === "MONTADOR" } : null,
  attachment:
    m.storageKey && !m.deletedAt
      ? { fileName: m.fileName, mimeType: m.mimeType, sizeBytes: m.sizeBytes, url: `/api/chat/messages/${m.id}/attachment` }
      : null,
});

/** Uma conversa na lista: os dois canais gerais e as de projeto/atividade. */
type ChannelListItem = {
  id: string;
  kind: string;
  name: string | null;
  memberCount: number;
  unread: number;
  lastMessage: { body: string; authorName: string | null; createdAt: Date } | null;
  project?: { id: string; code: string; name: string } | null;
  activity?: { id: string; number: string; service: string } | null;
};

// GET /api/chat/channels
router.get(
  "/channels",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const ids = await syncDefaultMemberships(me);
    const kinds = channelsFor(me);
    const [channels, unread] = await Promise.all([
      prisma.chatChannel.findMany({
        where: { id: { in: kinds.map((k) => ids[k]) } },
        include: {
          _count: { select: { members: true } },
          messages: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1, include: { author: { select: { name: true } } } },
        },
      }),
      unreadByChannel(me.id),
    ]);
    const list: ChannelListItem[] = kinds
      .map((kind) => channels.find((c) => c.kind === kind)!)
      .filter(Boolean)
      .map((c) => {
        const last = c.messages[0];
        return {
          id: c.id,
          kind: c.kind,
          name: c.name,
          memberCount: c._count.members,
          unread: unread.get(c.id) ?? 0,
          lastMessage: last
            ? { body: last.body || (last.fileName ? `📎 ${last.fileName}` : ""), authorName: last.author?.name ?? null, createdAt: last.createdAt }
            : null,
        };
      });

    // conversas de projeto/atividade em que a pessoa foi incluída
    const scoped = await prisma.chatChannel.findMany({
      where: {
        organizationId: me.organizationId,
        members: { some: { userId: me.id } },
        OR: [{ projectId: { not: null } }, { activityId: { not: null } }],
      },
      include: {
        _count: { select: { members: true } },
        project: { select: { id: true, code: true, name: true } },
        activity: { select: { id: true, number: true, service: true } },
        messages: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1, include: { author: { select: { name: true } } } },
      },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
    });

    for (const c of scoped) {
      const last = c.messages[0];
      list.push({
        id: c.id,
        kind: c.kind,
        name: c.name ?? "Conversa",
        memberCount: c._count.members,
        unread: unread.get(c.id) ?? 0,
        lastMessage: last
          ? { body: last.body || (last.fileName ? `📎 ${last.fileName}` : ""), authorName: last.author?.name ?? null, createdAt: last.createdAt }
          : null,
        project: c.project,
        activity: c.activity,
      });
    }

    return ok(res, list);
  })
);

// POST /api/chat/channels/project/:projectId -> abre (ou cria) a conversa do projeto
router.post(
  "/channels/project/:projectId",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, organizationId: me.organizationId },
      select: { id: true, code: true, name: true, managerId: true },
    });
    if (!project) throw new NotFoundError("Projeto não encontrado");

    // quem entra junto: o gestor e os montadores que trabalham nessa obra
    const montadores = await prisma.installationTask.findMany({
      where: { projectId: project.id },
      select: { contractor: { select: { userId: true, active: true } } },
      distinct: ["contractorId"],
    });
    const channel = await ensureScopedChannel(
      { kind: "PROJECT", projectId: project.id, name: `${project.code} · ${project.name}` },
      me,
      [project.managerId, ...montadores.filter((m) => m.contractor.active).map((m) => m.contractor.userId)]
    );
    return ok(res, { id: channel.id, kind: channel.kind, name: channel.name, project: { id: project.id, code: project.code, name: project.name } });
  })
);

// POST /api/chat/channels/activity/:activityId -> conversa da atividade
router.post(
  "/channels/activity/:activityId",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const activity = await prisma.activity.findFirst({
      where: { id: req.params.activityId, organizationId: me.organizationId },
      select: { id: true, number: true, service: true, employeeId: true, createdById: true },
    });
    if (!activity) throw new NotFoundError("Atividade não encontrada");

    const channel = await ensureScopedChannel(
      { kind: "ACTIVITY", activityId: activity.id, name: `${activity.number} · ${activity.service}` },
      me,
      [activity.employeeId, activity.createdById]
    );
    return ok(res, { id: channel.id, kind: channel.kind, name: channel.name, activity: { id: activity.id, number: activity.number, service: activity.service } });
  })
);

// POST /api/chat/channels/:id/members -> inclui alguém na conversa do projeto/atividade
router.post(
  "/channels/:id/members",
  requirePermission("chat.manage"),
  asyncHandler(async (req, res) => {
    const channel = await loadChannelFor(req.params.id, req.user!);
    if (!channel.projectId && !channel.activityId) throw new ValidationError("Os canais gerais têm participação automática");
    const { userIds } = z.object({ userIds: z.array(z.string().min(1)).min(1).max(50) }).parse(req.body);

    const validos = await prisma.user.findMany({
      where: { id: { in: userIds }, organizationId: req.user!.organizationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!validos.length) throw new ValidationError("Nenhum usuário válido informado");
    await prisma.chatMember.createMany({
      data: validos.map((u) => ({ channelId: channel.id, userId: u.id })),
      skipDuplicates: true,
    });
    return ok(res, { added: validos.length }, `${validos.length} participante(s) incluído(s)`);
  })
);

// GET /api/chat/search?q= -> procura nas conversas da pessoa
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) throw new ValidationError("Digite ao menos 2 caracteres para buscar");

    await syncDefaultMemberships(me);
    const rows = await prisma.chatMessage.findMany({
      where: {
        deletedAt: null,
        channel: { organizationId: me.organizationId, members: { some: { userId: me.id } } },
        OR: [{ body: { contains: q, mode: "insensitive" } }, { fileName: { contains: q, mode: "insensitive" } }],
      },
      include: { author: authorSelect, channel: { select: { id: true, kind: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: intQuery(req.query.limit, { min: 1, max: 100, name: "limit" }) ?? 40,
    });

    return ok(
      res,
      rows.map((m) => ({
        ...serializeMessage(m),
        channel: { id: m.channel.id, kind: m.channel.kind, name: m.channel.name },
      }))
    );
  })
);

// GET /api/chat/unread -> total (badge do menu)
router.get(
  "/unread",
  asyncHandler(async (req, res) => {
    const unread = await unreadByChannel(req.user!.id);
    return ok(res, { total: [...unread.values()].reduce((a, b) => a + b, 0) });
  })
);

// GET /api/chat/channels/:id/messages?after=&before=&limit=
router.get(
  "/channels/:id/messages",
  asyncHandler(async (req, res) => {
    const channel = await loadChannelFor(req.params.id, req.user!);
    const after = dateQuery(req.query.after, "after");
    const before = dateQuery(req.query.before, "before");
    const limit = intQuery(req.query.limit, { min: 1, max: 200, name: "limit" }) ?? 60;

    // "after" = só as novas (polling); padrão = as mais recentes
    const rows = await prisma.chatMessage.findMany({
      where: {
        channelId: channel.id,
        ...(after ? { createdAt: { gt: after } } : before ? { createdAt: { lt: before } } : {}),
      },
      include: { author: authorSelect, replyTo: replyToSelect },
      orderBy: { createdAt: after ? "asc" : "desc" },
      take: limit,
    });
    const ordered = after ? rows : rows.reverse();
    return ok(res, {
      channel: { id: channel.id, kind: channel.kind, name: channel.name },
      messages: ordered.map(serializeMessage),
      hasMore: !after && rows.length === limit,
    });
  })
);

// POST /api/chat/channels/:id/messages (JSON { body } ou multipart body + file)
router.post(
  "/channels/:id/messages",
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const channel = await loadChannelFor(req.params.id, me);
    const input = z
      .object({ body: z.string().max(4000).optional().default(""), replyToId: z.string().min(1).optional().nullable() })
      .parse(req.body ?? {});
    const body = input.body.trim();
    if (!body && !req.file) throw new ValidationError("Escreva uma mensagem ou anexe um arquivo");

    // só dá para responder mensagem da mesma conversa
    if (input.replyToId) {
      const alvo = await prisma.chatMessage.findFirst({
        where: { id: input.replyToId, channelId: channel.id, deletedAt: null },
        select: { id: true },
      });
      if (!alvo) throw new ValidationError("A mensagem que você está respondendo não existe mais nesta conversa");
    }

    let file: { storageKey: string; fileName: string; mimeType: string; sizeBytes: number } | null = null;
    if (req.file) {
      const key = buildStorageKey(`chat/${channel.id}`, req.file.originalname);
      await storage.put(key, req.file.buffer, req.file.mimetype);
      file = { storageKey: key, fileName: req.file.originalname, mimeType: req.file.mimetype, sizeBytes: req.file.size };
    }

    const now = new Date();
    const [message] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: { channelId: channel.id, authorId: me.id, body, replyToId: input.replyToId ?? null, ...(file ?? {}) },
        include: { author: authorSelect, replyTo: replyToSelect },
      }),
      prisma.chatChannel.update({ where: { id: channel.id }, data: { lastMessageAt: now } }),
      prisma.chatMember.upsert({
        where: { channelId_userId: { channelId: channel.id, userId: me.id } },
        create: { channelId: channel.id, userId: me.id, lastReadAt: now },
        update: { lastReadAt: now },
      }),
    ]);
    return ok(res, serializeMessage(message));
  })
);

// POST /api/chat/channels/:id/read
router.post(
  "/channels/:id/read",
  asyncHandler(async (req, res) => {
    const channel = await loadChannelFor(req.params.id, req.user!);
    await prisma.chatMember.upsert({
      where: { channelId_userId: { channelId: channel.id, userId: req.user!.id } },
      create: { channelId: channel.id, userId: req.user!.id, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
    return ok(res, { read: true });
  })
);

// DELETE /api/chat/messages/:id
router.delete(
  "/messages/:id",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const m = await prisma.chatMessage.findUnique({
      where: { id: req.params.id },
      select: { id: true, channelId: true, authorId: true, createdAt: true, storageKey: true, deletedAt: true },
    });
    if (!m || m.deletedAt) throw new NotFoundError("Mensagem não encontrada");
    await loadChannelFor(m.channelId, me);
    if (!canDeleteMessage(m, me)) throw new ForbiddenError("Só dá para apagar a própria mensagem nos primeiros 15 minutos");
    if (m.storageKey) await storage.remove(m.storageKey).catch(() => undefined);
    await prisma.chatMessage.update({ where: { id: m.id }, data: { deletedAt: new Date(), body: "", storageKey: null } });
    return ok(res, { id: m.id }, "Mensagem apagada");
  })
);

// GET /api/chat/messages/:id/attachment
router.get(
  "/messages/:id/attachment",
  asyncHandler(async (req, res) => {
    const m = await prisma.chatMessage.findUnique({ where: { id: req.params.id } });
    if (!m || m.deletedAt || !m.storageKey) throw new NotFoundError("Anexo não encontrado");
    await loadChannelFor(m.channelId, req.user!);
    const signed = await storage.getSignedUrl(m.storageKey, m.fileName ?? "arquivo");
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(m.storageKey);
    res.setHeader("Content-Type", m.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(m.fileName ?? "arquivo")}"`);
    return pipeToResponse(stream, res);
  })
);

export default router;
