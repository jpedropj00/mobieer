import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../prisma";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../../utils/ApiError";
import type { EnterpriseRegistrationInput } from "./auth.schema";

function signToken(userId: string) {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

function serializeUser(user: {
  id: string;
  name: string;
  email: string;
  position: string | null;
  sector: string | null;
  imageUrl: string | null;
  status: string;
  role: { id: string; name: string; label: string; permissions: { permission: { code: string } }[] };
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    position: user.position,
    sector: user.sector,
    imageUrl: user.imageUrl,
    status: user.status,
    role: user.role.name,
    roleLabel: user.role.label,
    permissions: user.role.permissions.map((rp) => rp.permission.code),
  };
}

export async function login(email: string, password: string, ip?: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      role: { include: { permissions: { include: { permission: true } } } }, organization: { include: { enterprise: true } },
    },
  });

  if (!user) throw new UnauthorizedError("Credenciais inválidas");
  if (user.status !== "ACTIVE") throw new UnauthorizedError("Usuário inativo");
  if (user.organization.enterprise.status !== "ACTIVE") throw new UnauthorizedError("Empresa inativa ou suspensa");

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new UnauthorizedError("Credenciais inválidas");

  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
  await prisma.auditLog.create({
    data: { userId: user.id, action: "LOGIN", entity: "User", entityId: user.id, ip: ip ?? null },
  });

  return { token: signToken(user.id), user: serializeUser(user) };
}

export async function registerEnterprise(input: EnterpriseRegistrationInput, ip?: string) {
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new BadRequestError("Este e-mail já está cadastrado");
  if (await prisma.enterprise.findUnique({ where: { slug: input.slug } })) throw new BadRequestError("Este identificador de empresa já está em uso");
  const role = await prisma.role.findUnique({ where: { name: "ADMIN" }, include: { permissions: { include: { permission: true } } } });
  if (!role) throw new BadRequestError("Perfil de administrador não configurado");
  const password = await bcrypt.hash(input.password, 12);
  const user = await prisma.$transaction(async tx => {
    const enterprise = await tx.enterprise.create({ data: { legalName: input.legalName, tradeName: input.tradeName || null, document: input.document || null, slug: input.slug, email, phone: input.phone || null } });
    const organization = await tx.organization.create({ data: { name: input.tradeName || input.legalName, enterpriseId: enterprise.id } });
    const created = await tx.user.create({ data: { name: input.adminName, email, password, position: "Administrador", sector: "Administração", roleId: role.id, organizationId: organization.id } });
    await tx.auditLog.create({ data: { userId: created.id, action: "ENTERPRISE_REGISTERED", entity: "Enterprise", entityId: enterprise.id, ip: ip ?? null, details: { slug: enterprise.slug } } });
    return created;
  });
  return { token: signToken(user.id), user: serializeUser({ ...user, role }) };
}

export async function logout(userId: string, ip?: string) {
  await prisma.auditLog.create({
    data: { userId, action: "LOGOUT", entity: "User", entityId: userId, ip: ip ?? null },
  });
  return true;
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });
  if (!user) throw new NotFoundError("Usuário não encontrado");
  return serializeUser(user);
}

export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return { resetRequested: true };

  const resetToken = crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1h

  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken, resetTokenExpiry: expiry },
  });

  // O token nunca deve atravessar a resposta HTTP. A entrega deve ser feita
  // somente por um canal confiável (por exemplo, o serviço de e-mail).
  return { resetRequested: true };
}

export async function resetPassword(token: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { resetToken: token } });
  if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
    throw new BadRequestError("Token inválido ou expirado");
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hash, resetToken: null, resetTokenExpiry: null },
  });
  await prisma.auditLog.create({
    data: { userId: user.id, action: "PASSWORD_RESET", entity: "User", entityId: user.id },
  });
  return true;
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("Usuário não encontrado");

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) throw new BadRequestError("Senha atual incorreta");

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { password: hash } });
  await prisma.auditLog.create({
    data: { userId, action: "PASSWORD_CHANGED", entity: "User", entityId: userId },
  });
  return true;
}
