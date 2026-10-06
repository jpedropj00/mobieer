/** Normaliza um telefone BR para o formato E.164 sem "+", ex: 5585999999999. */
export function normalizePhoneBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`; // DDD + número
  if (d.length === 8 || d.length === 9) return null; // sem DDD, não dá para inferir
  return d;
}
