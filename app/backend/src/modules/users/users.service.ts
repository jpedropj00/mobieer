import bcrypt from "bcryptjs";
import { prisma } from "../../prisma";
import crypto from "crypto";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { cleanExtraRoleIds } from "../../lib/user-roles";
import type { CreateUserInput, UpdateUserInput } from "./users.schema";

export function serializeUser(user: {
  id: string;
  name: string;
  email: string;
  position: string | null;
  sector: string | null;
  status: string;
  imageUrl: string | null;
  lastLogin: Date | null;
  createdAt: Date;
  role: { id: string; name: string; label: string };
  extraRoles?: { role: { id: string; name: string; label: string } }[];
  lockedAt?: Date | null;
  failedLoginCount?: number;
  mustChangePassword?: boolean;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    position: user.position,
    sector: user.sector,
    status: user.status,
    imageUrl: user.imageUrl,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    role: { id: user.role.id, name: user.role.name, label: user.role.label },
    extraRoles: (user.extraRoles ?? []).filter((e) => e.role.id !== user.role.id).map((e) => ({ id: e.role.id, name: e.role.name, label: e.role.label })),
    locked: Boolean(user.lockedAt),
    failedLoginCount: user.failedLoginCount ?? 0,
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

const userInclude = { role: true, extraRoles: { include: { role: true } } } as const;

/** Grava os cargos adicionais do usuário (substitui a lista). Cargo inexistente é recusado. */
async function setExtraRoles(userId: string, primaryRoleId: string, extraRoleIds: string[] | undefined) {
  if (extraRoleIds === undefined) return;
  const ids = cleanExtraRoleIds(primaryRoleId, extraRoleIds);
  if (ids.length) {
    const found = await prisma.role.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestError("Um dos cargos adicionais não existe mais. Recarregue a tela e tente de novo.");
  }
  await prisma.$transaction([
    prisma.userExtraRole.deleteMany({ where: { userId } }),
    ...(ids.length ? [prisma.userExtraRole.createMany({ data: ids.map((roleId) => ({ userId, roleId })) })] : []),
  ]);
}

/** Senha provisória que já atende a política padrão (maiúscula, minúscula, número). */
export function temporaryPassword() {
  const base = crypto.randomBytes(6).toString("base64url").replace(/[^A-Za-z0-9]/g, "x");
  return `Mb${base}${crypto.randomInt(10, 99)}`;
}

export async function listUsers(params: { page: number; perPage: number; search?: string; status?: string; roleId?: string }) {
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: "insensitive" } },
      { email: { contains: params.search, mode: "insensitive" } },
      { position: { contains: params.search, mode: "insensitive" } },
      { sector: { contains: params.search, mode: "insensitive" } },
    ];
  }
  if (params.status) where.status = params.status;
  // filtra por cargo principal ou adicional
  if (params.roleId) where.AND = [{ OR: [{ roleId: params.roleId }, { extraRoles: { some: { roleId: params.roleId } } }] }];

  const total = await prisma.user.count({ where });
  const pages = Math.max(1, Math.ceil(total / params.perPage));
  const users = await prisma.user.findMany({
    where,
    include: userInclude,
    orderBy: { name: "asc" },
    skip: (params.page - 1) * params.perPage,
    take: params.perPage,
  });

  return {
    items: users.map(serializeUser),
    meta: { page: params.page, perPage: params.perPage, total, pages },
  };
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: userInclude,
  });
  if (!user) throw new NotFoundError("Usuário não encontrado");
  return serializeUser(user);
}

export async function createUser(input: CreateUserInput, actorId: string) {
  // Sem senha informada, gera uma provisória; de todo jeito a pessoa troca no primeiro acesso.
  const password = input.password || temporaryPassword();
  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email.toLowerCase(),
      password: hash,
      position: input.position ?? null,
      sector: input.sector ?? null,
      status: input.status,
      imageUrl: input.imageUrl ?? null,
      roleId: input.roleId,
      mustChangePassword: true,
      passwordChangedAt: new Date(),
    },
    include: userInclude,
  });
  await setExtraRoles(user.id, user.roleId, input.extraRoleIds);
  const full = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "USER_CREATED",
      entity: "User",
      entityId: user.id,
      details: { email: user.email, role: user.role.name, extraRoles: full.extraRoles.map((e) => e.role.name) },
    },
  });

  // a provisória aparece uma vez só, para o admin repassar
  return { ...serializeUser(full), temporaryPassword: input.password ? undefined : password };
}

/** Desbloqueia quem errou a senha demais. */
export async function unlockUser(id: string, actorId: string) {
  const user = await prisma.user.findUnique({ where: { id }, include: userInclude });
  if (!user) throw new NotFoundError("Usuário não encontrado");
  const updated = await prisma.user.update({ where: { id }, data: { lockedAt: null, failedLoginCount: 0 }, include: userInclude });
  await prisma.auditLog.create({ data: { userId: actorId, action: "USER_UNLOCKED", entity: "User", entityId: id } });
  return serializeUser(updated);
}

/** "Limpar senha": gera uma provisória e obriga a troca no próximo acesso. Também desbloqueia. */
export async function resetUserPassword(id: string, actorId: string) {
  if (id === actorId) throw new BadRequestError("Para a sua própria senha, use Configurações > Alterar senha");
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError("Usuário não encontrado");
  const password = temporaryPassword();
  const updated = await prisma.user.update({
    where: { id },
    data: { password: await bcrypt.hash(password, 12), mustChangePassword: true, passwordChangedAt: new Date(), lockedAt: null, failedLoginCount: 0, resetToken: null, resetTokenExpiry: null },
    include: userInclude,
  });
  await prisma.auditLog.create({ data: { userId: actorId, action: "USER_PASSWORD_RESET_BY_ADMIN", entity: "User", entityId: id } });
  return { ...serializeUser(updated), temporaryPassword: password };
}

export async function updateUser(id: string, input: UpdateUserInput, actorId: string) {
  await getUser(id);

  const user = await prisma.user.update({
    where: { id },
    data: {
      name: input.name,
      email: input.email ? input.email.toLowerCase() : undefined,
      position: input.position,
      sector: input.sector,
      status: input.status,
      imageUrl: input.imageUrl,
      roleId: input.roleId,
    },
    include: userInclude,
  });
  // trocar só o cargo principal também limpa o adicional que ficou igual a ele
  await setExtraRoles(user.id, user.roleId, input.extraRoleIds ?? (input.roleId ? user.extraRoles.map((e) => e.roleId) : undefined));
  const full = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "USER_UPDATED",
      entity: "User",
      entityId: user.id,
      details: { email: user.email, role: user.role.name, extraRoles: full.extraRoles.map((e) => e.role.name), status: user.status },
    },
  });

  return serializeUser(full);
}

export async function deleteUser(id: string, actorId: string) {
  await getUser(id);
  await prisma.user.update({ where: { id }, data: { status: "INACTIVE" } });
  await prisma.auditLog.create({
    data: { userId: actorId, action: "USER_DEACTIVATED", entity: "User", entityId: id },
  });
  return true;
}

export async function listRoles() {
  const roles = await prisma.role.findMany({
    include: {
      permissions: {
        include: { permission: { select: { id: true, code: true, label: true, module: true } } },
        orderBy: { permission: { module: "asc" } },
      },
      _count: { select: { users: true } },
    },
    orderBy: { name: "asc" },
  });

  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    label: role.label,
    description: role.description,
    userCount: role._count.users,
    permissions: role.permissions.map((rp) => rp.permission),
  }));
}

export async function updateRolePermissions(roleId: string, permissionCodes: string[], actorId: string) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw new NotFoundError("Perfil não encontrado");

  const permissions = permissionCodes.length
    ? await prisma.permission.findMany({ where: { code: { in: permissionCodes } } })
    : [];

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId, permissionId: p.id })),
      });
    }
  });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "ROLE_PERMISSIONS_UPDATED",
      entity: "Role",
      entityId: roleId,
      details: { role: role.name, permissions: permissionCodes },
    },
  });

  return listRoles().then((roles) => roles.find((r) => r.id === roleId));
}

export async function listPermissions() {
  const permissions = await prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { label: "asc" }],
  });
  return permissions;
}
