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
import { canDeleteMessage, channelsFor, loadChannelFor, syncDefaultMemberships, unreadByChannel } from "./chat.service";

/** /api/chat — dois canais: "Equipe" e "Equipe + montadores" */
const router = Router();
router.use(authenticate, requirePermission("chat.use"));

const authorSelect = { select: { id: true, name: true, imageUrl: true, role: { select: { name: true } } } } as const;

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
  author: { id: string; name: string; imageUrl: string | null; role: { name: string } } | null;
}) => ({
  id: m.id,
  channelId: m.channelId,
  body: m.deletedAt ? "" : m.body,
  deleted: Boolean(m.deletedAt),
  createdAt: m.createdAt,
  editedAt: m.editedAt,
  author: m.author ? { id: m.author.id, name: m.author.name, imageUrl: m.author.imageUrl, isContractor: m.author.role.name === "MONTADOR" } : null,
  attachment:
    m.storageKey && !m.deletedAt
      ? { fileName: m.fileName, mimeType: m.mimeType, sizeBytes: m.sizeBytes, url: `/api/chat/messages/${m.id}/attachment` }
      : null,
});

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
    const list = kinds
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
    return ok(res, list);
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
      include: { author: authorSelect },
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
    const input = z.object({ body: z.string().max(4000).optional().default("") }).parse(req.body ?? {});
    const body = input.body.trim();
    if (!body && !req.file) throw new ValidationError("Escreva uma mensagem ou anexe um arquivo");

    let file: { storageKey: string; fileName: string; mimeType: string; sizeBytes: number } | null = null;
    if (req.file) {
      const key = buildStorageKey(`chat/${channel.id}`, req.file.originalname);
      await storage.put(key, req.file.buffer, req.file.mimetype);
      file = { storageKey: key, fileName: req.file.originalname, mimeType: req.file.mimetype, sizeBytes: req.file.size };
    }

    const now = new Date();
    const [message] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: { channelId: channel.id, authorId: me.id, body, ...(file ?? {}) },
        include: { author: authorSelect },
      }),
      prisma.chatChannel.update({ where: { id: channel.id }, data: { lastMessageAt: now } }),
      prisma.chatMember.update({ where: { channelId_userId: { channelId: channel.id, userId: me.id } }, data: { lastReadAt: now } }),
    ]);
    return ok(res, serializeMessage(message));
  })
);

// POST /api/chat/channels/:id/read
router.post(
  "/channels/:id/read",
  asyncHandler(async (req, res) => {
    const channel = await loadChannelFor(req.params.id, req.user!);
    await prisma.chatMember.update({
      where: { channelId_userId: { channelId: channel.id, userId: req.user!.id } },
      data: { lastReadAt: new Date() },
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
