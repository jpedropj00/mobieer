/**
 * Chat interno com dois canais fixos:
 * - TEAM ("Equipe"): só a equipe interna da loja.
 * - CONTRACTORS ("Equipe + montadores"): toda a equipe interna e os montadores.
 *
 * Os dois aceitam texto e documentos/fotos. A participação é sincronizada
 * quando a pessoa abre o chat — ninguém precisa ser adicionado à mão, e o
 * montador nunca enxerga o canal só da equipe.
 */
import type { AuthUser } from "../../types/express";
import { prisma } from "../../prisma";
import { ForbiddenError, NotFoundError } from "../../utils/ApiError";

export const MONTADOR_ROLE = "MONTADOR";
export const isContractorUser = (u: Pick<AuthUser, "role">) => u.role === MONTADOR_ROLE;

export const CHANNELS = {
  TEAM: "Equipe",
  CONTRACTORS: "Equipe + montadores",
} as const;
export type ChatKind = keyof typeof CHANNELS;

/** Canais que a pessoa deve ver. */
export function channelsFor(user: Pick<AuthUser, "role">): ChatKind[] {
  return isContractorUser(user) ? ["CONTRACTORS"] : ["TEAM", "CONTRACTORS"];
}

/** Pode ler/escrever no canal? (pura, para testes) */
export function canAccessChannel(channel: { kind: string }, user: Pick<AuthUser, "role">) {
  return (channelsFor(user) as string[]).includes(channel.kind);
}

async function ensureChannel(organizationId: string, kind: ChatKind) {
  const existing = await prisma.chatChannel.findFirst({ where: { organizationId, kind }, select: { id: true, name: true } });
  if (existing) {
    if (existing.name !== CHANNELS[kind]) await prisma.chatChannel.update({ where: { id: existing.id }, data: { name: CHANNELS[kind] } });
    return existing.id;
  }
  const created = await prisma.chatChannel.create({ data: { organizationId, kind, name: CHANNELS[kind] } });
  return created.id;
}

/** Garante os dois canais e a participação correta do usuário. */
export async function syncDefaultMemberships(user: AuthUser) {
  const ids: Record<ChatKind, string> = {
    TEAM: await ensureChannel(user.organizationId, "TEAM"),
    CONTRACTORS: await ensureChannel(user.organizationId, "CONTRACTORS"),
  };
  const want = channelsFor(user).map((k) => ids[k]);
  const notWanted = (Object.keys(ids) as ChatKind[]).map((k) => ids[k]).filter((id) => !want.includes(id));

  await prisma.chatMember.createMany({ data: want.map((channelId) => ({ channelId, userId: user.id })), skipDuplicates: true });
  // quem mudou de perfil (ex.: montador que virou equipe) sai do que não é mais dele
  if (notWanted.length) await prisma.chatMember.deleteMany({ where: { userId: user.id, channelId: { in: notWanted } } });
  return ids;
}

export async function loadChannelFor(channelId: string, user: AuthUser) {
  const channel = await prisma.chatChannel.findFirst({ where: { id: channelId, organizationId: user.organizationId } });
  if (!channel) throw new NotFoundError("Conversa não encontrada");
  if (!canAccessChannel(channel, user)) throw new ForbiddenError("Você não participa desta conversa");
  await syncDefaultMemberships(user);
  return channel;
}

/** Mensagens não lidas por canal para o usuário. */
export async function unreadByChannel(userId: string) {
  const memberships = await prisma.chatMember.findMany({ where: { userId }, select: { channelId: true, lastReadAt: true } });
  const counts = await Promise.all(
    memberships.map(async (m) => ({
      channelId: m.channelId,
      unread: await prisma.chatMessage.count({
        where: {
          channelId: m.channelId,
          deletedAt: null,
          authorId: { not: userId },
          ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
        },
      }),
    }))
  );
  return new Map(counts.map((c) => [c.channelId, c.unread]));
}

/** Janela para o autor apagar a própria mensagem. */
export const DELETE_WINDOW_MS = 15 * 60 * 1000;

export function canDeleteMessage(
  message: { authorId: string | null; createdAt: Date },
  user: { id: string; permissions: string[] },
  now = new Date()
) {
  if (user.permissions.includes("chat.manage")) return true;
  return message.authorId === user.id && now.getTime() - message.createdAt.getTime() <= DELETE_WINDOW_MS;
}
