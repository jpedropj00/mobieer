/**
 * Caminho para a IA no projeto técnico. A partir das medidas digitadas
 * (tech-drawing.rules) saem duas coisas, sem rede e sem banco:
 *
 *   techAiBrief   o móvel em dados estruturados — o que qualquer IA precisa saber
 *   techAiPrompt  a instrução para um modelo de imagem gerar a perspectiva 3D
 *                 a partir da vista cotada
 *
 * A parte fixa da instrução protege o projeto: a IA não pode mudar medida,
 * quantidade nem posição de nada — só dar volume, material e luz.
 */
import { layoutDrawing, mm, type DrawingSpec } from "./tech-drawing.rules";

export const TECH_AI_VIEWS = ["FECHADO", "ABERTO"] as const;
export type TechAiView = (typeof TECH_AI_VIEWS)[number];
export const MAX_AI_EXTRA_CHARS = 600;

export type TechAiBrief = {
  cliente: string;
  ambiente: string;
  movel: string;
  medidas_mm: { largura: number; altura: number; profundidade: number | null; topo: number; rodape: number; espessura_chapa: number | null };
  colunas: {
    posicao: number;
    tipo: "prateleiras" | "portas" | "gavetas" | "vao_livre";
    largura_mm: number;
    portas: number;
    prateleiras: number;
    gavetas: number;
    /** de cima para baixo */
    alturas_mm: number[];
    observacao: string | null;
  }[];
  especificacoes: string[];
};

const KIND = { PRATELEIRAS: "prateleiras", PORTAS: "portas", GAVETAS: "gavetas", VAO: "vao_livre" } as const;
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const r1 = (n: number) => Math.round(n * 10) / 10;

export function techAiBrief(spec: DrawingSpec, ctx: { client: string; room: string }): TechAiBrief {
  const L = layoutDrawing(spec);
  return {
    cliente: clean(ctx.client),
    ambiente: clean(ctx.room),
    movel: clean(spec.description) || "Móvel planejado",
    medidas_mm: { largura: L.width, altura: L.height, profundidade: spec.depth && spec.depth > 0 ? spec.depth : null, topo: L.top, rodape: L.base, espessura_chapa: spec.thickness && spec.thickness > 0 ? spec.thickness : null },
    colunas: L.columns.map((c, i) => ({
      posicao: i + 1,
      tipo: KIND[c.kind],
      largura_mm: r1(c.width),
      portas: c.doors,
      prateleiras: c.kind === "GAVETAS" ? 0 : c.lines.length,
      gavetas: c.kind === "GAVETAS" ? c.bands.length : 0,
      alturas_mm: [...c.bands].reverse().map((b) => r1(b.value)),
      observacao: clean(spec.columns[i]?.note) || null,
    })),
    especificacoes: (spec.specs ?? []).map(clean).filter(Boolean),
  };
}

/** O móvel em uma frase por coluna, da esquerda para a direita. */
export function describeColumns(brief: TechAiBrief): string[] {
  return brief.colunas.map((c) => {
    const what =
      c.tipo === "portas"
        ? `${c.portas} ${c.portas > 1 ? "portas de abrir" : "porta de abrir"}${c.prateleiras ? `, com ${c.prateleiras} ${c.prateleiras > 1 ? "prateleiras" : "prateleira"} por dentro` : ""}`
        : c.tipo === "prateleiras"
          ? `nicho aberto com ${c.prateleiras} ${c.prateleiras > 1 ? "prateleiras" : "prateleira"}`
          : c.tipo === "gavetas"
            ? `${c.gavetas} ${c.gavetas > 1 ? "gavetas" : "gaveta"}`
            : "vão livre, sem frente";
    return `Coluna ${c.posicao} (${mm(c.largura_mm)} mm de largura): ${what}${c.observacao ? ` — ${c.observacao}` : ""}.`;
  });
}

export function techAiPrompt(spec: DrawingSpec, ctx: { client: string; room: string }, view: TechAiView, extra?: string | null): string {
  const b = techAiBrief(spec, ctx);
  const m = b.medidas_mm;
  const lines = [
    `Esta imagem é a vista frontal técnica (com cotas em milímetros) de um móvel planejado: ${b.movel}, para o ambiente ${b.ambiente || "informado no projeto"}.`,
    `Gere uma perspectiva 3D fotorrealista DESTE MESMO móvel, ${view === "ABERTO" ? "com todas as portas abertas, mostrando o interior" : "com as portas fechadas"}.`,
    "",
    "Medidas reais:",
    `- Largura ${mm(m.largura)} mm, altura ${mm(m.altura)} mm${m.profundidade ? `, profundidade ${mm(m.profundidade)} mm` : ""}.`,
    ...(m.rodape > 0 ? [`- Rodapé de ${mm(m.rodape)} mm.`] : []),
    ...(m.topo > 0 ? [`- Faixa superior de ${mm(m.topo)} mm.`] : []),
    "",
    "Composição, da esquerda para a direita:",
    ...describeColumns(b).map((l) => `- ${l}`),
    ...(b.especificacoes.length ? ["", "Materiais e acabamentos:", ...b.especificacoes.map((s) => `- ${s}`)] : []),
    "",
    "Obrigatório:",
    "- Mantenha as proporções da vista: mesma largura de cada coluna, mesma quantidade e mesma posição de portas, prateleiras e gavetas.",
    "- Não acrescente, não remova e não mova nada. Não invente puxadores, nichos, iluminação ou objetos que não estão descritos.",
    "- Perspectiva levemente de lado e de cima, mostrando frente, uma lateral e o tampo; o móvel inteiro dentro do quadro.",
    "- Fundo neutro e claro de estúdio, piso discreto, sombra suave. Sem pessoas e sem decoração.",
    "- Nenhum texto na imagem: sem cotas, sem legendas, sem marca d'água.",
    ...(clean(extra) ? ["", `Pedido da equipe: ${clean(extra).slice(0, MAX_AI_EXTRA_CHARS)}`] : []),
  ];
  return lines.join("\n");
}
