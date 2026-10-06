import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../prisma";
import { ApiError, BadRequestError, NotFoundError, UnauthorizedError } from "../../utils/ApiError";
import { accessAllowedAny, passwordExpired } from "../../lib/security-policy";
import { allRoles, effectivePermissions, roleNames, rolesInclude, rolesLabel } from "../../lib/user-roles";
import { assertStrongPassword, loadSecurityPolicy, setUserPassword } from "../../lib/security";
import { notifyUsersWithPermission } from "../../lib/notify";
import { renderResetEmail, sendMail } from "../../lib/mailer";
import { MFA_RECOMMENDED_ROLES } from "../../lib/totp.rules";
import type { EnterpriseRegistrationInput } from "./auth.schema";

function signToken(userId: string) {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

/**
 * Passe de 5 minutos entre a senha certa e o código do autenticador. É assinado
 * com outro segredo: não serve como sessão em nenhuma rota.
 */
const mfaSecretKey = () => `${env.jwtSecret}:mfa-step`;
export function signMfaToken(userId: string) {
  return jwt.sign({ sub: userId, purpose: "mfa" }, mfaSecretKey(), { expiresIn: "5m" });
}
export function readMfaToken(token: string): string {
  try {
    const p = jwt.verify(token, mfaSecretKey()) as { sub?: string; purpose?: string };
    if (p.purpose !== "mfa" || !p.sub) throw new Error("passe inválido");
    return p.sub;
  } catch {
    throw new UnauthorizedError("A verificação expirou. Entre de novo com e-mail e senha.");
  }
}

/** Conclui o login depois do segundo fator: registra o acesso e entrega a sessão. */
export async function issueSession(userId: string, ip?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: rolesInclude });
  const policy = await loadSecurityPolicy();
  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date(), failedLoginCount: 0 } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN", entity: "User", entityId: user.id, ip: ip ?? null, details: { mfa: true } } });
  const passwordChangeRequired = user.mustChangePassword || passwordExpired(user.passwordChangedAt, policy);
  return { token: signToken(user.id), user: serializeUser({ ...user, passwordChangeRequired }) };
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
  extraRoles?: { role: { id: string; name: string; label: string; permissions: { permission: { code: string } }[] } }[];
  mustChangePassword?: boolean;
  passwordChangeRequired?: boolean;
  mfaEnabledAt?: Date | null;
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
    // todos os cargos da pessoa; as permissões são a soma deles
    roles: roleNames(user),
    extraRoles: allRoles(user).slice(1).map((r) => ({ id: r.id, name: r.name, label: r.label })),
    roleLabel: rolesLabel(user),
    permissions: effectivePermissions(user),
    // senha provisória (definida pelo admin) ou vencida: a tela manda trocar antes de tudo
    passwordChangeRequired: Boolean(user.passwordChangeRequired ?? user.mustChangePassword),
    // verificação em duas etapas: se está ativa e se o perfil é dos que deveriam ativar
    mfaEnabled: Boolean(user.mfaEnabledAt),
    mfaRecommended: !user.mfaEnabledAt && roleNames(user).some((r) => MFA_RECOMMENDED_ROLES.includes(r)),
  };
}

export async function login(email: string, password: string, ip?: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      ...rolesInclude, organization: { include: { enterprise: true } },
    },
  });

  if (!user) throw new UnauthorizedError("Credenciais inválidas");
  if (user.status !== "ACTIVE") throw new UnauthorizedError("Usuário inativo");
  if (user.organization.enterprise.status !== "ACTIVE") throw new UnauthorizedError("Empresa inativa ou suspensa");
  if (user.lockedAt) {
    throw new ApiError(423, "Usuário bloqueado por excesso de tentativas. Peça ao administrador para desbloquear ou use Esqueci minha senha.", undefined, "ACCOUNT_LOCKED");
  }

  const policy = await loadSecurityPolicy();
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    const attempts = user.failedLoginCount + 1;
    const lock = policy.maxAttempts > 0 && attempts >= policy.maxAttempts;
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: attempts, lockedAt: lock ? new Date() : null } });
    await prisma.auditLog.create({ data: { userId: user.id, action: lock ? "LOGIN_LOCKED" : "LOGIN_FAILED", entity: "User", entityId: user.id, ip: ip ?? null, details: { attempts } } });
    if (lock) {
      await notifyUsersWithPermission({
        organizationId: user.organizationId,
        permission: "users.manage",
        title: "Usuário bloqueado",
        message: `${user.name} errou a senha ${attempts} vezes e foi bloqueado. Desbloqueie em Usuários se for ele mesmo.`,
      });
      throw new ApiError(423, "Senha errada muitas vezes: usuário bloqueado. Peça ao administrador para desbloquear.", undefined, "ACCOUNT_LOCKED");
    }
    const left = policy.maxAttempts > 0 ? policy.maxAttempts - attempts : null;
    throw new UnauthorizedError(left != null && left <= 2 ? `Credenciais inválidas — mais ${left} tentativa(s) antes do bloqueio` : "Credenciais inválidas");
  }

  const access = accessAllowedAny(policy, { roles: roleNames(user), ip });
  if (!access.ok) {
    await prisma.auditLog.create({ data: { userId: user.id, action: `LOGIN_DENIED_${access.reason}`, entity: "User", entityId: user.id, ip: ip ?? null } });
    throw new ApiError(403, access.message, undefined, "ACCESS_RESTRICTED");
  }

  // senha certa, mas a conta tem verificação em duas etapas: a sessão só sai depois do código
  if (user.mfaEnabledAt && user.mfaSecret) {
    return { mfaRequired: true as const, mfaToken: signMfaToken(user.id) };
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date(), failedLoginCount: 0 } });
  await prisma.auditLog.create({
    data: { userId: user.id, action: "LOGIN", entity: "User", entityId: user.id, ip: ip ?? null },
  });

  const passwordChangeRequired = user.mustChangePassword || passwordExpired(user.passwordChangedAt, policy);
  return { token: signToken(user.id), user: serializeUser({ ...user, passwordChangeRequired }) };
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
    include: rolesInclude,
  });
  if (!user) throw new NotFoundError("Usuário não encontrado");
  const policy = await loadSecurityPolicy();
  return serializeUser({ ...user, passwordChangeRequired: user.mustChangePassword || passwordExpired(user.passwordChangedAt, policy) });
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

  // O token nunca atravessa a resposta HTTP: vai só por e-mail.
  const company = await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { enterprise: { select: { tradeName: true, legalName: true } } } });
  const mail = renderResetEmail({
    name: user.name,
    companyName: company?.enterprise.tradeName ?? company?.enterprise.legalName ?? "Mobieer",
    link: `${env.appUrl}/redefinir-senha?token=${resetToken}`,
  });
  await sendMail({ to: user.email, ...mail }).catch(() => undefined);
  await prisma.auditLog.create({ data: { userId: user.id, action: "PASSWORD_RESET_REQUESTED", entity: "User", entityId: user.id } });
  return { resetRequested: true };
}

export async function resetPassword(token: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { resetToken: token } });
  if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
    throw new BadRequestError("Token inválido ou expirado");
  }

  await assertStrongPassword(newPassword, user);
  // redefinir pelo e-mail também desbloqueia: quem recebeu o link é o dono da conta
  await setUserPassword(user.id, newPassword, { currentHash: user.password });
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

  await assertStrongPassword(newPassword, user);
  await setUserPassword(userId, newPassword, { currentHash: user.password });
  await prisma.auditLog.create({
    data: { userId, action: "PASSWORD_CHANGED", entity: "User", entityId: userId },
  });
  return true;
}
