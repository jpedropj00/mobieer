import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../prisma";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../../utils/ApiError";

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
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });

  if (!user) throw new UnauthorizedError("Credenciais inválidas");
  if (user.status !== "ACTIVE") throw new UnauthorizedError("Usuário inativo");

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new UnauthorizedError("Credenciais inválidas");

  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
  await prisma.auditLog.create({
    data: { userId: user.id, action: "LOGIN", entity: "User", entityId: user.id, ip: ip ?? null },
  });

  return { token: signToken(user.id), user: serializeUser(user) };
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
  if (!user) return { resetToken: null };

  const resetToken = crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1h

  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken, resetTokenExpiry: expiry },
  });

  return { resetToken };
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
