/**
 * Verificação em duas etapas por aplicativo autenticador (TOTP, RFC 6238):
 * código de 6 dígitos que muda a cada 30 segundos. Sem dependência externa —
 * é HMAC-SHA1 sobre o contador de tempo. Também os códigos de recuperação.
 */
import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("segredo inválido");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Segredo novo (160 bits), em base32, para o aplicativo autenticador. */
export const generateSecret = () => base32Encode(crypto.randomBytes(20));

/** Código do instante `timeMs`. */
export function totp(secretBase32: string, timeMs = Date.now()): string {
  const counter = Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Confere o código aceitando um passo antes e um depois (relógio do celular
 * levemente adiantado ou atrasado). Comparação em tempo constante.
 */
export function verifyTotp(secretBase32: string, code: string, timeMs = Date.now(), window = 1): boolean {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return false;
  for (let w = -window; w <= window; w++) {
    const expected = totp(secretBase32, timeMs + w * TOTP_STEP_SECONDS * 1000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return true;
  }
  return false;
}

/** Endereço que o aplicativo lê pelo QR Code. */
export function otpauthUrl(secretBase32: string, account: string, issuer = "Mobieer"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// ---------------------------------------------------------------- códigos de recuperação

/** 10 códigos de uso único, no formato XXXXX-XXXXX, para quando o celular não estiver à mão. */
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const raw = base32Encode(crypto.randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z2-7]/g, "");
/** Só o hash fica no banco: quem ler a tabela não consegue usar os códigos. */
export const hashRecoveryCode = (code: string) => crypto.createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");

/** Consome um código de recuperação: devolve a lista sem ele, ou null se não existe. */
export function consumeRecoveryCode(hashes: string[], code: string): string[] | null {
  if (normalizeRecoveryCode(code).length !== 10) return null;
  const h = hashRecoveryCode(code);
  return hashes.includes(h) ? hashes.filter((x) => x !== h) : null;
}

// ---------------------------------------------------------------- segredo cifrado no banco

/** AES-256-GCM: o segredo do autenticador não fica legível no banco. */
export function sealSecret(plain: string, key: string): string {
  const k = crypto.createHash("sha256").update(key).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function openSecret(sealed: string, key: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("segredo ilegível");
  const k = crypto.createHash("sha256").update(key).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Perfis para os quais a verificação em duas etapas é recomendada com destaque. */
export const MFA_RECOMMENDED_ROLES = ["ADMIN", "MANAGER", "FINANCEIRO"];
