/** Medidas da peça para a etiqueta da fábrica: "600 × 720 × 18 mm". */
export function partItemMeasures(it: { width: unknown; height: unknown; depth: unknown; thickness: unknown }): string | null {
  const n = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? String(Number(x.toFixed(2))) : null;
  };
  const dims = [n(it.width), n(it.height), n(it.depth)].filter(Boolean);
  const thickness = n(it.thickness);
  if (!dims.length && !thickness) return null;
  const main = dims.join(" × ");
  if (!thickness) return `${main} mm`;
  return main ? `${main} × ${thickness} mm` : `esp. ${thickness} mm`;
}
