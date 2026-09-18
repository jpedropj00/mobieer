import { prisma } from "../prisma";

/**
 * Notificação interna (sino) para quem tem uma permissão na organização, mais
 * usuários extras (ex.: o responsável pelo chamado). Não duplica destinatário.
 */
export async function notifyUsersWithPermission(opts: {
  organizationId: string;
  permission: string;
  title: string;
  message: string;
  extraUserIds?: (string | null | undefined)[];
  excludeUserId?: string | null;
}) {
  const users = await prisma.user.findMany({
    where: {
      organizationId: opts.organizationId,
      status: "ACTIVE",
      role: { permissions: { some: { permission: { code: opts.permission } } } },
    },
    select: { id: true },
  });
  const ids = new Set<string>([...users.map((u) => u.id), ...(opts.extraUserIds ?? []).filter((x): x is string => Boolean(x))]);
  if (opts.excludeUserId) ids.delete(opts.excludeUserId);
  if (!ids.size) return 0;
  await prisma.notification.createMany({
    data: [...ids].map((userId) => ({ type: "INFO" as const, title: opts.title, message: opts.message, userId })),
  });
  return ids.size;
}

export async function notifyUser(userId: string | null | undefined, title: string, message: string) {
  if (!userId) return;
  await prisma.notification.create({ data: { type: "INFO", title, message, userId } });
}
