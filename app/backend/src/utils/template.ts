/**
 * Substituição de marcadores `{{campo}}` em textos (contratos e mensagens).
 *
 * A troca é feita por função, então valores com `$&`, `$1` ou `{{...}}` entram
 * literais — um nome de cliente nunca vira outro marcador.
 */
export function renderTemplate(body: string, values: Record<string, string>) {
  const missing = new Set<string>();
  const text = body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = values[key];
    if (v === undefined) {
      missing.add(key);
      return "____";
    }
    if (v === "") missing.add(key);
    return v;
  });
  return { text, missing: [...missing] };
}

/** Marcadores usados num texto (para validar modelo antes de salvar). */
export function templateKeys(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))];
}

/** Primeiro nome, para mensagens mais próximas ("Olá, Maria"). */
export const firstName = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] ?? "";
