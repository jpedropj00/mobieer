/**
 * O navegador manda o nome do arquivo em UTF-8, mas o multer lê como Latin-1:
 * "orçamento.pdf" chega "orÃ§amento.pdf". Se reinterpretar como UTF-8 der um
 * texto válido, era esse o caso.
 */
export function fixUploadName(name: string): string {
  if (!/[Â-ô][-¿]/.test(name)) return name;
  const fixed = Buffer.from(name, "latin1").toString("utf8");
  return fixed.includes("�") ? name : fixed;
}
