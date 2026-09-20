import { InvalidQueryError } from "./ApiError";

/**
 * Leitura segura de parâmetros de URL (`req.query`).
 *
 * Valor vindo da URL é texto livre. Repassar direto ao Prisma (`status as never`)
 * faz um `?status=qualquer` estourar como 500. Estes helpers validam antes e
 * respondem 400 INVALID_QUERY com a lista do que é aceito.
 */

type QueryValue = unknown;

/** Primeiro valor de um parâmetro (`?a=1&a=2` vira "1"); vazio vira undefined. */
export function queryString(value: QueryValue): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/** Enum opcional. Aceita array de valores ou o objeto de enum do Prisma. */
export function enumQuery<T extends string>(
  value: QueryValue,
  allowed: readonly T[] | Record<string, T>,
  name = "parâmetro"
): T | undefined {
  const raw = queryString(value);
  if (raw === undefined) return undefined;
  const list = (Array.isArray(allowed) ? allowed : Object.values(allowed)) as readonly T[];
  const match = list.find((a) => a === raw) ?? list.find((a) => a.toLowerCase() === raw.toLowerCase());
  if (!match) {
    throw new InvalidQueryError(`Valor inválido para ${name}: "${raw}"`, { param: name, allowed: list });
  }
  return match;
}

/** Data opcional (aaaa-mm-dd ou ISO). */
export function dateQuery(value: QueryValue, name = "data"): Date | undefined {
  const raw = queryString(value);
  if (raw === undefined) return undefined;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new InvalidQueryError(`Data inválida em ${name}: "${raw}"`, { param: name });
  }
  return d;
}

/** Inteiro opcional com faixa; fora da faixa é erro (não corta silenciosamente). */
export function intQuery(
  value: QueryValue,
  opts: { min?: number; max?: number; name?: string } = {}
): number | undefined {
  const raw = queryString(value);
  const name = opts.name ?? "número";
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(raw)) throw new InvalidQueryError(`Valor inteiro inválido em ${name}: "${raw}"`, { param: name });
  const n = Number(raw);
  if ((opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) {
    throw new InvalidQueryError(`${name} fora da faixa permitida`, { param: name, min: opts.min, max: opts.max });
  }
  return n;
}

/** Booleano de URL: 1/true/sim e 0/false/nao. */
export function boolQuery(value: QueryValue): boolean | undefined {
  const raw = queryString(value)?.toLowerCase();
  if (raw === undefined) return undefined;
  if (["1", "true", "sim", "yes"].includes(raw)) return true;
  if (["0", "false", "nao", "não", "no"].includes(raw)) return false;
  throw new InvalidQueryError(`Valor booleano inválido: "${raw}"`);
}
