/**
 * Carrega a política de segurança (Setting "security.policy") com cache curto
 * — o authenticate consulta a cada requisição — e concentra a troca de senha,
 * para toda senha nova passar pela mesma regra.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { BadRequestError } from "../utils/ApiError";
import { normalizePolicy, passwordMessage, passwordProblems, type SecurityPolicy } from "./security-policy";

export const SECURITY_SETTING = "security.policy";
const TTL_MS = 60_000;
let cache: { at: number; policy: SecurityPolicy } | null = null;

export async function loadSecurityPolicy(): Promise<SecurityPolicy> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.policy;
  const row = await prisma.setting.findUnique({ where: { key: SECURITY_SETTING } });
  let policy: SecurityPolicy;
  try {
    policy = normalizePolicy(row ? JSON.parse(row.value) : null);
  } catch {
    policy = normalizePolicy(null);
  }
  cache = { at: Date.now(), policy };
  return policy;
}

export async function saveSecurityPolicy(p: SecurityPolicy) {
  const value = JSON.stringify(normalizePolicy(p));
  await prisma.setting.upsert({ where: { key: SECURITY_SETTING }, create: { key: SECURITY_SETTING, value }, update: { value } });
  cache = null;
}

/** Recusa senha fraca com a lista do que falta. */
export async function assertStrongPassword(pw: string, ctx: { name?: string | null; email?: string | null }) {
  const problems = passwordProblems(pw, await loadSecurityPolicy(), ctx);
  if (problems.length) throw new BadRequestError(passwordMessage(problems));
}

/**
 * Grava a senha nova (já validada ou não). `temporary` = definida por outra
 * pessoa (admin): a própria pessoa troca no próximo acesso.
 */
export async function setUserPassword(userId: string, pw: string, opts: { temporary?: boolean; currentHash?: string } = {}) {
  if (opts.currentHash && (await bcrypt.compare(pw, opts.currentHash))) {
    throw new BadRequestError("A senha nova precisa ser diferente da atual");
  }
  const hash = await bcrypt.hash(pw, 10);
  await prisma.user.update({
    where: { id: userId },
    data: {
      password: hash,
      passwordChangedAt: new Date(),
      mustChangePassword: Boolean(opts.temporary),
      failedLoginCount: 0,
      lockedAt: null,
      resetToken: null,
      resetTokenExpiry: null,
    },
  });
}
