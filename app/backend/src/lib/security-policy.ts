/**
 * Política de segurança da loja: força e validade da senha, bloqueio por
 * tentativas, e restrição de acesso por IP e por dia/horário (por perfil).
 * Regras puras — quem lê a configuração e aplica é o login e o authenticate.
 *
 * O administrador nunca fica preso pelas restrições de IP e horário: se a
 * regra for mal configurada, é ele quem conserta.
 */
import net from "node:net";

export type AccessSchedule = {
  /** perfil (Role.name) a que a janela se aplica */
  role: string;
  /** 0 = domingo … 6 = sábado */
  days: number[];
  /** "HH:MM" no fuso da loja */
  start: string;
  end: string;
};

export type SecurityPolicy = {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  /** dias até exigir troca; 0 = nunca expira */
  expiryDays: number;
  /** erros seguidos até bloquear; 0 = não bloqueia */
  maxAttempts: number;
  /** IPs ou faixas (CIDR IPv4) liberados; vazio = qualquer IP */
  allowedIps: string[];
  /** perfis que entram de qualquer IP (além do ADMIN) */
  ipExemptRoles: string[];
  /** janelas de acesso por perfil; perfil sem janela entra a qualquer hora */
  schedules: AccessSchedule[];
};

export const DEFAULT_POLICY: SecurityPolicy = {
  minLength: 8,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: false,
  expiryDays: 0,
  maxAttempts: 5,
  allowedIps: [],
  ipExemptRoles: [],
  schedules: [],
};

export const ALWAYS_ALLOWED_ROLE = "ADMIN";
export const STORE_TZ = "America/Fortaleza";

export function normalizePolicy(raw: unknown): SecurityPolicy {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<SecurityPolicy>;
  const int = (v: unknown, d: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    minLength: int(o.minLength, DEFAULT_POLICY.minLength, 6, 64),
    requireUpper: bool(o.requireUpper, DEFAULT_POLICY.requireUpper),
    requireLower: bool(o.requireLower, DEFAULT_POLICY.requireLower),
    requireDigit: bool(o.requireDigit, DEFAULT_POLICY.requireDigit),
    requireSymbol: bool(o.requireSymbol, DEFAULT_POLICY.requireSymbol),
    expiryDays: int(o.expiryDays, DEFAULT_POLICY.expiryDays, 0, 365),
    maxAttempts: int(o.maxAttempts, DEFAULT_POLICY.maxAttempts, 0, 20),
    allowedIps: Array.isArray(o.allowedIps) ? o.allowedIps.map(String).map((s) => s.trim()).filter(Boolean) : [],
    ipExemptRoles: Array.isArray(o.ipExemptRoles) ? o.ipExemptRoles.map(String) : [],
    schedules: Array.isArray(o.schedules) ? o.schedules.filter((s) => s && typeof s.role === "string") : [],
  };
}

/** O que falta na senha, em frases para a tela. Vazio = senha aceita. */
export function passwordProblems(pw: string, p: SecurityPolicy, ctx: { name?: string | null; email?: string | null } = {}): string[] {
  const out: string[] = [];
  if (pw.length < p.minLength) out.push(`ter pelo menos ${p.minLength} caracteres`);
  if (p.requireUpper && !/[A-Z]/.test(pw)) out.push("ter uma letra maiúscula");
  if (p.requireLower && !/[a-z]/.test(pw)) out.push("ter uma letra minúscula");
  if (p.requireDigit && !/\d/.test(pw)) out.push("ter um número");
  if (p.requireSymbol && !/[^A-Za-z0-9]/.test(pw)) out.push("ter um símbolo (ex.: ! @ # $)");
  const low = pw.toLowerCase();
  const emailUser = ctx.email?.split("@")[0]?.toLowerCase();
  const firstName = ctx.name?.trim().split(/\s+/)[0]?.toLowerCase();
  if ((emailUser && emailUser.length >= 4 && low.includes(emailUser)) || (firstName && firstName.length >= 4 && low.includes(firstName))) {
    out.push("não conter o seu nome ou e-mail");
  }
  if (/^(.)\1+$/.test(pw) || ["12345678", "123456789", "password", "senha123", "mudar123", "qwerty123"].includes(low)) out.push("não ser uma senha óbvia");
  return out;
}

export const passwordMessage = (problems: string[]) => `A senha precisa ${problems.join(", ")}.`;

export function passwordExpired(changedAt: Date | null, p: SecurityPolicy, now = new Date()) {
  if (!p.expiryDays) return false;
  if (!changedAt) return true; // nunca trocou desde que a política passou a valer
  return now.getTime() - changedAt.getTime() > p.expiryDays * 86_400_000;
}

/** IP do jeito que o Express entrega (pode vir "::ffff:1.2.3.4"). */
export function cleanIp(ip: string | null | undefined) {
  if (!ip) return "";
  return ip.replace(/^::ffff:/, "").trim();
}

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

export function ipMatches(ip: string, rule: string) {
  const a = cleanIp(ip);
  const r = rule.trim();
  if (!a || !r) return false;
  if (r.includes("/")) {
    const [base, bitsStr] = r.split("/");
    const bits = Number(bitsStr);
    if (!net.isIPv4(base) || !net.isIPv4(a) || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipv4ToInt(a) & mask) === (ipv4ToInt(base) & mask);
  }
  return cleanIp(r) === a;
}

export const validIpRule = (rule: string) => {
  const r = rule.trim();
  if (r.includes("/")) {
    const [base, bits] = r.split("/");
    return net.isIPv4(base) && /^\d{1,2}$/.test(bits) && Number(bits) <= 32;
  }
  return net.isIP(r) !== 0;
};

/** Hora e dia da semana no fuso da loja. */
export function localClock(now: Date, tz = STORE_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hh = Number(get("hour")) % 24;
  return { day, minutes: hh * 60 + Number(get("minute")) };
}

const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export type AccessDecision = { ok: true } | { ok: false; reason: "IP" | "SCHEDULE"; message: string };

/** Pode entrar agora, deste IP? Chamado no login e a cada requisição. */
export function accessAllowed(p: SecurityPolicy, u: { role: string; ip: string | null | undefined }, now = new Date()): AccessDecision {
  if (u.role === ALWAYS_ALLOWED_ROLE) return { ok: true };
  if (p.allowedIps.length && !p.ipExemptRoles.includes(u.role) && !p.allowedIps.some((r) => ipMatches(u.ip ?? "", r))) {
    return { ok: false, reason: "IP", message: "Acesso não liberado a partir desta rede. Fale com o administrador da loja." };
  }
  const windows = p.schedules.filter((s) => s.role === u.role);
  if (windows.length) {
    const { day, minutes } = localClock(now);
    const inside = windows.some((w) => {
      const a = toMin(w.start);
      const b = toMin(w.end);
      if (a == null || b == null || !w.days.includes(day)) return false;
      return a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b; // janela que vira a meia-noite
    });
    if (!inside) return { ok: false, reason: "SCHEDULE", message: "Fora do horário de acesso liberado para o seu perfil." };
  }
  return { ok: true };
}
