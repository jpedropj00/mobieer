/**
 * Verificação em duas etapas (aplicativo autenticador): /api/auth/mfa
 *
 *   POST /verify            { mfaToken, code } — segunda etapa do login (código de 6 dígitos ou de recuperação)
 *   GET  /status            se está ativa e quantos códigos de recuperação restam
 *   POST /setup             gera o segredo e o QR Code (ainda não ativa)
 *   POST /enable            { code } — confirma o primeiro código, ativa e devolve os códigos de recuperação
 *   POST /disable           { password, code } — desativa
 *   POST /reset/:userId     quem gerencia usuários desliga a de outra pessoa (celular perdido)
 *
 * Opcional para todos; a tela destaca a recomendação para administrador, gestor e financeiro.
 */
import bcrypt from "bcryptjs";
import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { env } from "../../config/env";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { loadSecurityPolicy } from "../../lib/security";
import { consumeRecoveryCode, generateRecoveryCodes, generateSecret, hashRecoveryCode, openSecret, otpauthUrl, sealSecret, verifyTotp } from "../../lib/totp.rules";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError, BadRequestError, NotFoundError, UnauthorizedError } from "../../utils/ApiError";
import { LIMITS, rateLimit } from "../../utils/rate-limit";
import { ok } from "../../utils/response";
import { issueSession, readMfaToken } from "./auth.service";

const router = Router();
const sealKey = () => (process.env.MFA_ENCRYPTION_KEY || "").trim() || `${env.jwtSecret}:mfa-secret`;
const code6 = z.string().trim().min(6, "Informe o código").max(20);

// ---------------------------------------------------------------- segunda etapa do login (sem sessão)

router.post(
  "/mfa/verify",
  rateLimit({ name: "auth-mfa", ...LIMITS.auth }),
  asyncHandler(async (req, res) => {
    const input = z.object({ mfaToken: z.string().min(10), code: code6 }).parse(req.body);
    const userId = readMfaToken(input.mfaToken);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, status: true, lockedAt: true, failedLoginCount: true, mfaSecret: true, mfaEnabledAt: true, mfaRecoveryCodes: true } });
    if (!user || user.status !== "ACTIVE" || !user.mfaEnabledAt || !user.mfaSecret) throw new UnauthorizedError("Verificação indisponível. Entre de novo com e-mail e senha.");
    if (user.lockedAt) throw new ApiError(423, "Usuário bloqueado por excesso de tentativas. Peça ao administrador para desbloquear.", undefined, "ACCOUNT_LOCKED");

    let okCode = verifyTotp(openSecret(user.mfaSecret, sealKey()), input.code);
    let usedRecovery = false;
    if (!okCode) {
      const remaining = consumeRecoveryCode(user.mfaRecoveryCodes, input.code);
      if (remaining) {
        await prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryCodes: remaining } });
        okCode = true;
        usedRecovery = true;
      }
    }
    if (!okCode) {
      // código errado conta como tentativa de login: mesma regra de bloqueio da senha
      const policy = await loadSecurityPolicy();
      const attempts = user.failedLoginCount + 1;
      const lock = policy.maxAttempts > 0 && attempts >= policy.maxAttempts;
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: attempts, lockedAt: lock ? new Date() : null } });
      await prisma.auditLog.create({ data: { userId: user.id, action: lock ? "LOGIN_LOCKED" : "MFA_FAILED", entity: "User", entityId: user.id, ip: req.ip ?? null, details: { attempts } } });
      if (lock) throw new ApiError(423, "Código errado muitas vezes: usuário bloqueado. Peça ao administrador para desbloquear.", undefined, "ACCOUNT_LOCKED");
      throw new UnauthorizedError("Código incorreto. Confira o aplicativo autenticador e tente de novo.");
    }
    if (usedRecovery) await prisma.auditLog.create({ data: { userId: user.id, action: "MFA_RECOVERY_CODE_USED", entity: "User", entityId: user.id, ip: req.ip ?? null } });
    return ok(res, await issueSession(user.id, req.ip), usedRecovery ? "Login realizado com um código de recuperação" : "Login realizado com sucesso");
  })
);

// ---------------------------------------------------------------- configuração (com sessão)

router.get(
  "/mfa/status",
  authenticate,
  asyncHandler(async (req, res) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { mfaEnabledAt: true, mfaRecoveryCodes: true } });
    return ok(res, { enabled: Boolean(u.mfaEnabledAt), enabledAt: u.mfaEnabledAt, recoveryCodesLeft: u.mfaEnabledAt ? u.mfaRecoveryCodes.length : 0 });
  })
);

router.post(
  "/mfa/setup",
  authenticate,
  asyncHandler(async (req, res) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { mfaEnabledAt: true } });
    if (u.mfaEnabledAt) throw new BadRequestError("A verificação em duas etapas já está ativa. Desative antes de configurar de novo.");
    const secret = generateSecret();
    // fica guardado cifrado e sem data de ativação: só vale depois de confirmar o primeiro código
    await prisma.user.update({ where: { id: req.user!.id }, data: { mfaSecret: sealSecret(secret, sealKey()), mfaRecoveryCodes: [] } });
    const url = otpauthUrl(secret, req.user!.email);
    return ok(res, { secret, qr: await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 240 }) });
  })
);

router.post(
  "/mfa/enable",
  authenticate,
  asyncHandler(async (req, res) => {
    const { code } = z.object({ code: code6 }).parse(req.body);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { mfaSecret: true, mfaEnabledAt: true } });
    if (u.mfaEnabledAt) throw new BadRequestError("A verificação em duas etapas já está ativa.");
    if (!u.mfaSecret) throw new BadRequestError("Comece pela configuração: gere o QR Code primeiro.");
    if (!verifyTotp(openSecret(u.mfaSecret, sealKey()), code)) throw new BadRequestError("Código incorreto. Confira se o relógio do celular está certo e tente de novo.");
    const codes = generateRecoveryCodes();
    await prisma.user.update({ where: { id: req.user!.id }, data: { mfaEnabledAt: new Date(), mfaRecoveryCodes: codes.map(hashRecoveryCode) } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "MFA_ENABLED", entity: "User", entityId: req.user!.id, ip: req.ip ?? null } });
    return ok(res, { enabled: true, recoveryCodes: codes }, "Verificação em duas etapas ativada");
  })
);

router.post(
  "/mfa/disable",
  authenticate,
  asyncHandler(async (req, res) => {
    const input = z.object({ password: z.string().min(1, "Informe a sua senha"), code: code6 }).parse(req.body);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { password: true, mfaSecret: true, mfaEnabledAt: true, mfaRecoveryCodes: true } });
    if (!u.mfaEnabledAt || !u.mfaSecret) throw new BadRequestError("A verificação em duas etapas não está ativa.");
    if (!(await bcrypt.compare(input.password, u.password))) throw new BadRequestError("Senha incorreta.");
    if (!verifyTotp(openSecret(u.mfaSecret, sealKey()), input.code) && !consumeRecoveryCode(u.mfaRecoveryCodes, input.code)) throw new BadRequestError("Código incorreto.");
    await prisma.user.update({ where: { id: req.user!.id }, data: { mfaSecret: null, mfaEnabledAt: null, mfaRecoveryCodes: [] } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "MFA_DISABLED", entity: "User", entityId: req.user!.id, ip: req.ip ?? null } });
    return ok(res, { enabled: false }, "Verificação em duas etapas desativada");
  })
);

router.post(
  "/mfa/reset/:userId",
  authenticate,
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findFirst({ where: { id: req.params.userId, organizationId: req.user!.organizationId }, select: { id: true, name: true, mfaEnabledAt: true } });
    if (!target) throw new NotFoundError("Usuário não encontrado");
    await prisma.user.update({ where: { id: target.id }, data: { mfaSecret: null, mfaEnabledAt: null, mfaRecoveryCodes: [] } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "MFA_RESET_BY_ADMIN", entity: "User", entityId: target.id, ip: req.ip ?? null, details: { wasEnabled: Boolean(target.mfaEnabledAt) } } });
    return ok(res, { enabled: false }, `Verificação em duas etapas de ${target.name} desligada. A pessoa entra só com a senha e pode configurar de novo.`);
  })
);

export default router;
