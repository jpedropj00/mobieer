/**
 * Render com IA: a imagem do ambiente exportada do Promob vira um render
 * fotorrealista com os acabamentos do projeto. Aqui ficam o texto enviado à
 * IA e as regras da lista de renders — sem rede e sem banco.
 */

export type RenderLighting = "DIA" | "NOITE" | "ESTUDIO";

export type RenderRequest = {
  room: string;
  /** Acabamentos e ajustes pedidos pela equipe (texto livre). */
  finishes: string;
  lighting: RenderLighting;
  /** Pedido de ajuste sobre um render anterior. */
  adjustment?: string | null;
};

export type RenderItem = {
  id: string;
  room: string;
  finishes: string;
  lighting: RenderLighting;
  adjustment: string | null;
  sourceKey: string;
  sourceMime: string;
  resultKey: string;
  resultMime: string;
  /** Render que serviu de base, quando este é um ajuste. */
  parentId: string | null;
  createdAt: string;
  createdBy: string;
};

export const MAX_RENDERS_PER_PROJECT = 40;
export const MAX_FINISHES_CHARS = 1200;
export const LIGHTING_LABEL: Record<RenderLighting, string> = { DIA: "Luz natural do dia", NOITE: "Noite, com a iluminação do ambiente acesa", ESTUDIO: "Luz neutra de estúdio" };

const LIGHTING_PROMPT: Record<RenderLighting, string> = {
  DIA: "Iluminação natural de dia, suave, entrando pelas aberturas que já existem na imagem.",
  NOITE: "Cena noturna, com a iluminação artificial do ambiente acesa em tom quente e as fitas de LED dos móveis ligadas, se existirem na imagem.",
  ESTUDIO: "Iluminação neutra e uniforme de estúdio, sem sombras duras.",
};

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * Instrução para o modelo de imagem. A parte fixa protege o projeto: o render
 * não pode mudar medidas, quantidade nem posição dos móveis — só material e luz.
 */
export function renderPrompt(r: RenderRequest): string {
  const lines = [
    `Esta é uma imagem técnica de um projeto de móveis planejados (ambiente: ${clean(r.room) || "ambiente"}), exportada de um software de projeto.`,
    "Gere um render fotorrealista de arquitetura de interiores DESTA MESMA cena.",
    "",
    "Obrigatório:",
    "- Mantenha exatamente o mesmo enquadramento, a mesma perspectiva e as mesmas proporções.",
    "- Mantenha a quantidade, a posição e o tamanho de todos os móveis, portas, gavetas, prateleiras, puxadores, bancadas, cubas e eletrodomésticos.",
    "- Não acrescente, não remova e não mova móveis nem aberturas. Não mude o desenho das portas.",
    "- Remova cotas, textos, linhas de chamada, marcas d'água e carimbos; o resultado não tem nenhum texto.",
    "- Materiais com textura e reflexo reais (veio da madeira, fosco ou brilho da laca, pedra da bancada), sombras e profundidade coerentes.",
    "",
    LIGHTING_PROMPT[r.lighting],
  ];
  const finishes = clean(r.finishes);
  if (finishes) lines.push("", "Acabamentos a aplicar (o que não for citado fica como está na imagem):", finishes);
  const adjustment = clean(r.adjustment);
  if (adjustment) lines.push("", "Ajuste pedido sobre esta versão, sem alterar o restante:", adjustment);
  return lines.join("\n");
}

type QuoteItem = { room: string | null; description: string; corpo?: string | null; porta?: string | null; puxador?: string | null; complemento?: string | null; modelo?: string | null };

/** Texto de acabamentos sugerido para o ambiente, a partir do orçamento. */
export function finishesFromQuote(items: QuoteItem[], room: string): string {
  const key = clean(room).toLowerCase();
  const parts: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const v = clean(value);
    if (v && !parts.some((p) => p.startsWith(`${label}:`))) parts.push(`${label}: ${v}`);
  };
  for (const it of items) {
    if (clean(it.room || it.description).toLowerCase() !== key) continue;
    add("Caixaria", it.corpo);
    add("Portas e frentes", it.porta);
    add("Puxadores", it.puxador);
    add("Complemento", it.complemento);
    add("Modelo", it.modelo);
  }
  return parts.join(". ");
}

/** Mais novo primeiro. */
export function sortRenders(items: RenderItem[]): RenderItem[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Um arquivo só pode ser apagado do armazenamento quando nenhum outro render o usa. */
export function orphanKeys(remaining: RenderItem[], removed: RenderItem): string[] {
  const used = new Set(remaining.flatMap((r) => [r.sourceKey, r.resultKey]));
  return [...new Set([removed.sourceKey, removed.resultKey])].filter((k) => !used.has(k));
}
