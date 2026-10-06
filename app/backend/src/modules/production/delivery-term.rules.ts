/**
 * Termo de entrega (modelo da loja): a folha "Preparando o ambiente" e a
 * "Autorização de produção", com a relação de ambientes e os prazos. A loja
 * preenche e assina; o cliente lê e assina no portal.
 *
 * Aqui ficam só os textos e as contas; o PDF sai do delivery-term.pdf.ts.
 */

export type DeliveryTermData = {
  /** nº do contrato citado na autorização */
  contractNumber: string;
  /** ambientes aprovados: data (aaaa-mm-dd) e nome */
  rooms: { date: string; room: string }[];
  /** prazos: "Prazo de entrega do material", "Prazo de entrega cozinha"… */
  deadlines: { label: string; date: string | null }[];
  /** dias úteis citados no aviso de prazo */
  deliveryDays: number;
  city: string;
  /** data do termo (aaaa-mm-dd) */
  date: string;
};

export const PREPARING_ITEMS = [
  "Para que o serviço de instalação ocorra de forma satisfatória e no tempo previsto, não deverá permanecer nos mesmos ambientes outras equipes além da equipe da Mobieer - Ambientes Planejados;",
  "O ambiente deverá ser entregue totalmente limpo. Livre de entulhos e de materiais de construção. Se houver móveis existentes nos ambientes, deverão ser removidos;",
  "Se for necessário remover rodapés para a instalação dos móveis, eles serão recolocados por conta do cliente;",
  "É de obrigação do cliente tomar as providências para o fornecimento de energia elétrica/iluminação no local, antecedendo à data marcada para a instalação;",
  "É de obrigação do cliente entregar o ambiente com as alterações de pontos elétricos, pontos hidráulicos, pontos de gás, paredes, bancadas em granito/mármore, gesso etc. concluídas (quando houver);",
  "O cliente deverá fornecer, antes da data prevista para a instalação dos móveis, os projetos elétricos, hidráulicos, sanitários, de aquecimento, refrigeração, gás ou de qualquer outra natureza dos locais onde serão instalados os armários, ou fazer marcações visíveis nas paredes por onde passam tais tubulações. A inexistência desses projetos mencionados desobriga a Mobieer de qualquer responsabilidade por eventuais danos de instalação;",
  "A contratada não fará nenhum serviço de pintura e ajustes de gesso no ambiente após a montagem;",
  "É de obrigação do cliente disponibilizar um WC para uso dos instaladores;",
  "Os eletrodomésticos de embutir nos móveis (forno, micro-ondas e lava-louças), quando solicitados em projeto, deverão estar no local para a adaptação no ato da montagem; a visita posterior para esse fim será cobrada como visita adicional;",
  "Caso o projeto seja enviado antes da conclusão da obra, o cliente se responsabilizará por qualquer modificação que venha a ser necessária no projeto, estando ciente de que demolição, construção e instalação de bancadas podem vir a modificar medidas realizadas anteriormente a essas realizações.",
];

export const attentionText = (days: number) =>
  `Atenção: O prazo de entrega do material são ${days} dias úteis, tendo sua contagem iniciada a partir da aprovação/assinatura da Pasta Técnica Executiva por parte do CONTRATANTE. 5 dias úteis antes desse prazo o setor de logística entrará em contato para o agendamento e envio do cronograma de montagem; após a entrega do material, a montagem poderá ser iniciada em até 5 dias úteis.`;

export const authorizationIntro = (contractNumber: string) =>
  `Declaro que estou ciente de que o projeto técnico apresentado está de acordo com o que foi vendido e aprovado em contrato N° ${contractNumber.trim() || "__________"}.`;

export const AUTHORIZATION_TEXT =
  "Após essa aprovação a fabricação dos móveis será iniciada e contará o prazo de produção previamente estabelecido. Caso o cliente deseje realizar quaisquer alterações após a entrega do mobiliário, serão cobrados valores adicionais referentes às mesmas.";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-08-05" → "05/08/2026"; vazio ou inválido → espaço para preencher à mão */
export function brDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "____/____/______";
}

/** "Fortaleza, 5 de agosto de 2026." */
export function longDate(city: string, iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const where = city.trim() || "Fortaleza";
  if (!m || !MONTHS[Number(m[2]) - 1]) return `${where}, ____ de ____________ de ______.`;
  return `${where}, ${Number(m[3])} de ${MONTHS[Number(m[2]) - 1]} de ${m[1]}.`;
}

/** Ambientes do orçamento, sem repetir, para a relação já vir preenchida. */
export function roomsFromQuote(items: { room: string | null }[], date: string): { date: string; room: string }[] {
  const seen = new Set<string>();
  const out: { date: string; room: string }[] = [];
  for (const it of items) {
    const room = (it.room ?? "").replace(/\s+/g, " ").trim();
    if (!room || seen.has(room.toLowerCase())) continue;
    seen.add(room.toLowerCase());
    out.push({ date, room: room.toUpperCase() });
  }
  return out;
}

/** CPF/CNPJ só com números ganha a pontuação; o que já veio formatado fica como está. */
export function formatDocument(doc: string | null | undefined): string {
  const raw = (doc ?? "").trim();
  const d = raw.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return raw;
}
