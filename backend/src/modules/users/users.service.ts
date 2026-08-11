import bcrypt from "bcryptjs";
import { prisma } from "../../prisma";
import { NotFoundError } from "../../utils/ApiError";
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
  };
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
  if (params.roleId) where.roleId = params.roleId;

  const total = await prisma.user.count({ where });
  const pages = Math.max(1, Math.ceil(total / params.perPage));
  const users = await prisma.user.findMany({
    where,
    include: { role: true },
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
    include: { role: true },
  });
  if (!user) throw new NotFoundError("Usuário não encontrado");
  return serializeUser(user);
}

export async function createUser(input: CreateUserInput, actorId: string) {
  const password = input.password || "mudar123";
  const hash = await bcrypt.hash(password, 10);

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
    },
    include: { role: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "USER_CREATED",
      entity: "User",
      entityId: user.id,
      details: { email: user.email, role: user.role.name },
    },
  });

  return serializeUser(user);
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
    include: { role: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "USER_UPDATED",
      entity: "User",
      entityId: user.id,
      details: { email: user.email, role: user.role.name, status: user.status },
    },
  });

  return serializeUser(user);
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
