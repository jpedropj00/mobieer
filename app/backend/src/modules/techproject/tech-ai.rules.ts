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

export type TechAiPart = {
  tipo: "prateleiras" | "portas" | "gavetas" | "vao_livre" | "sapateira" | "maleiro" | "outros";
  /** nome escrito pela pessoa, quando o tipo é "outros" */
  nome: string | null;
  altura_mm: number;
  portas: number;
  prateleiras: number;
  gavetas: number;
  /** vãos livres (ou frentes de gaveta), de cima para baixo */
  alturas_mm: number[];
};

export type TechAiBrief = {
  cliente: string;
  ambiente: string;
  movel: string;
  medidas_mm: { largura: number; altura: number; profundidade: number | null; roda_teto: number; rodape: number; fechamento_esquerdo: number; fechamento_direito: number; espessura_chapa: number };
  colunas: {
    posicao: number;
    largura_mm: number;
    observacao: string | null;
    /** de cima para baixo; a coluna simples tem um trecho só */
    trechos: TechAiPart[];
  }[];
  especificacoes: string[];
};

const KIND = { PRATELEIRAS: "prateleiras", PORTAS: "portas", GAVETAS: "gavetas", VAO: "vao_livre", SAPATEIRA: "sapateira", MALEIRO: "maleiro", OUTROS: "outros" } as const;
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const r1 = (n: number) => Math.round(n * 10) / 10;

export function techAiBrief(spec: DrawingSpec, ctx: { client: string; room: string }): TechAiBrief {
  const L = layoutDrawing(spec);
  return {
    cliente: clean(ctx.client),
    ambiente: clean(ctx.room),
    movel: clean(spec.description) || "Móvel planejado",
    medidas_mm: { largura: L.width, altura: L.height, profundidade: spec.depth && spec.depth > 0 ? spec.depth : null, roda_teto: L.top, rodape: L.base, fechamento_esquerdo: L.sideLeft, fechamento_direito: L.sideRight, espessura_chapa: L.thickness },
    colunas: L.columns.map((c, i) => {
      const typed = spec.columns[i]?.parts?.length ? spec.columns[i].parts! : [spec.columns[i]];
      return {
        posicao: i + 1,
        largura_mm: r1(c.width),
        observacao: clean(spec.columns[i]?.note) || null,
        // o desenho guarda de baixo para cima; aqui vai na ordem em que foi digitado
        trechos: [...c.parts].reverse().map((p, j) => ({
          tipo: KIND[p.kind],
          nome: p.kind === "OUTROS" ? clean(typed[j]?.label) || null : null,
          altura_mm: r1(p.y1 - p.y0),
          portas: p.doors,
          prateleiras: p.kind === "GAVETAS" ? 0 : p.lines.length,
          gavetas: p.kind === "GAVETAS" ? p.bands.length : 0,
          alturas_mm: [...p.bands].reverse().map((b) => r1(b.value)),
        })),
      };
    }),
    especificacoes: (spec.specs ?? []).map(clean).filter(Boolean),
  };
}

/** O móvel em uma frase por coluna, da esquerda para a direita. */
function describePart(c: TechAiPart): string {
  const n = c.prateleiras;
  if (c.tipo === "portas") return `${c.portas} ${c.portas > 1 ? "portas de abrir" : "porta de abrir"}${n ? `, com ${n} ${n > 1 ? "prateleiras" : "prateleira"} por dentro` : ""}`;
  if (c.tipo === "prateleiras") return `nicho aberto com ${n} ${n === 1 ? "prateleira" : "prateleiras"}`;
  if (c.tipo === "gavetas") return `${c.gavetas} ${c.gavetas > 1 ? "gavetas" : "gaveta"}`;
  if (c.tipo === "sapateira") return `sapateira com ${n} ${n === 1 ? "prateleira inclinada" : "prateleiras inclinadas"} para sapatos`;
  if (c.tipo === "maleiro") return `maleiro (compartimento alto para malas)${n ? `, com ${n} ${n > 1 ? "divisões" : "divisão"}` : ""}`;
  if (c.tipo === "outros") return `${c.nome ?? "outro compartimento"}${n ? `, com ${n} ${n > 1 ? "divisões" : "divisão"}` : ""}`;
  return "vão livre, sem frente";
}

export function describeColumns(brief: TechAiBrief): string[] {
  return brief.colunas.map((c) => {
    const what = c.trechos.length > 1 ? `de cima para baixo: ${c.trechos.map((p) => `${describePart(p)} (${mm(p.altura_mm)} mm de altura)`).join("; ")}` : describePart(c.trechos[0]);
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
    ...(m.roda_teto > 0 ? [`- Roda-teto (faixa de acabamento em cima) de ${mm(m.roda_teto)} mm.`] : []),
    ...(m.fechamento_esquerdo > 0 ? [`- Fechamento lateral esquerdo de ${mm(m.fechamento_esquerdo)} mm, na altura toda.`] : []),
    ...(m.fechamento_direito > 0 ? [`- Fechamento lateral direito de ${mm(m.fechamento_direito)} mm, na altura toda.`] : []),
    `- Chapas e prateleiras com ${mm(m.espessura_chapa)} mm de espessura.`,
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
