/**
 * Cronograma de montagem que vai para o cliente (modelo da planilha da loja):
 * semanas de trabalho com os dias úteis, o que é instalado em cada etapa, a
 * vistoria final e as observações. Regras puras.
 */

const DAY = 86_400_000;
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const dd = (d: Date) => String(d.getUTCDate()).padStart(2, "0");

export type ScheduleWeek = { from: string; to: string; businessDays: number; label: string };

/** Rótulo da semana como na planilha: "SEMANA DO DIA 01 A 04 DE JULHO (3 DIAS ÚTEIS)". */
export function weekLabel(from: string, to: string, days: number) {
  const a = parse(from);
  const b = parse(to);
  if (from === to) return `SEMANA DO DIA ${dd(a)} DE ${MONTHS[a.getUTCMonth()]} (1 DIA ÚTIL)`.toUpperCase();
  const range =
    a.getUTCMonth() === b.getUTCMonth()
      ? `${dd(a)} A ${dd(b)} DE ${MONTHS[b.getUTCMonth()]}`
      : `${dd(a)} DE ${MONTHS[a.getUTCMonth()]} A ${dd(b)} DE ${MONTHS[b.getUTCMonth()]}`;
  return `SEMANA DE ${range} (${days} ${days === 1 ? "DIA ÚTIL" : "DIAS ÚTEIS"})`.toUpperCase();
}

/** Dias úteis entre início e fim (seg–sex, sem feriado), agrupados por semana. */
export function buildWeeks(start: string, end: string, holidays: Set<string> = new Set()): ScheduleWeek[] {
  const a = parse(start);
  const b = parse(end);
  if (!(a <= b)) return [];
  const weeks: { days: Date[] }[] = [];
  let key = "";
  for (let d = a; d <= b; d = new Date(d.getTime() + DAY)) {
    if (isWeekend(d) || holidays.has(toIso(d))) continue;
    // a semana começa na segunda: a chave é a segunda-feira daquela semana
    const monday = toIso(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY));
    if (monday !== key) {
      weeks.push({ days: [] });
      key = monday;
    }
    weeks[weeks.length - 1].days.push(d);
  }
  return weeks.map((w) => {
    const from = toIso(w.days[0]);
    const to = toIso(w.days[w.days.length - 1]);
    return { from, to, businessDays: w.days.length, label: weekLabel(from, to, w.days.length) };
  });
}

/** Vistoria final: o primeiro dia útil depois do fim da montagem. */
export function inspectionDate(end: string, holidays: Set<string> = new Set()) {
  let d = new Date(parse(end).getTime() + DAY);
  while (isWeekend(d) || holidays.has(toIso(d))) d = new Date(d.getTime() + DAY);
  return toIso(d);
}

/** Finais de semana dentro do período (cada sábado conta um). */
export function weekendsBetween(start: string, end: string) {
  let n = 0;
  for (let d = parse(start); d <= parse(end); d = new Date(d.getTime() + DAY)) if (d.getUTCDay() === 6) n++;
  return n;
}

/** Fim sugerido: N dias úteis a partir do início. */
export function addBusinessDays(start: string, days: number, holidays: Set<string> = new Set()) {
  let d = parse(start);
  let left = Math.max(1, days);
  for (;;) {
    if (!isWeekend(d) && !holidays.has(toIso(d))) left--;
    if (left === 0) return toIso(d);
    d = new Date(d.getTime() + DAY);
  }
}

export type InstallationScheduleData = {
  start: string;
  end: string;
  ambientes: string;
  address: string;
  /** o que é instalado em cada semana (uma lista por semana, na ordem) */
  stages: string[][];
  /** linhas em destaque (vermelho) logo abaixo da tabela */
  highlights: string[];
  /** OBS1, OBS2… ao lado da legenda */
  obs: string[];
  /** faixa amarela depois da legenda */
  closing: string[];
  /** observações adicionais (obs 01, obs 02…) */
  extra: string[];
};

export const DEFAULT_SCHEDULE_TEXT = {
  highlights: [
    "APÓS A CONCLUSÃO DA PRÉ-MONTAGEM, SERÁ AGENDADA A ENTREGA DO MATERIAL PARA A MONTAGEM IN LOCO.",
    "O CONTRATO PREVÊ ALINHAMENTO DE LOGÍSTICA E DE MONTAGEM EM ATÉ 8 DIAS ÚTEIS; NO FORMATO DE PRÉ-MONTAGEM, USAMOS ESSE PRAZO DENTRO DA FÁBRICA PARA MINIMIZAR OS TRABALHOS EXTERNOS.",
  ],
  obs: ["O PRAZO PREVÊ POSSÍVEIS AJUSTES VERIFICADOS IN LOCO."],
  closing: [
    "APÓS A FINALIZAÇÃO DA MONTAGEM, SERÃO NECESSÁRIOS AINDA 2 DIAS PARA LIMPEZA DOS MÓVEIS E ÁREAS DE TRABALHO.",
    "CASO A MONTAGEM ENCERRE ANTES DA DATA PREVISTA, SERÁ ALINHADA PREVIAMENTE A DATA DE VISTORIA.",
  ],
  extra: [
    "APÓS A FINALIZAÇÃO DA MARCENARIA SERÁ INICIADA A PRODUÇÃO DAS PORTAS DE VIDRO, METALON, PORTAS DE PALHA, PINTURA, PORTAS PROVENÇAIS ETC.",
    "MÓVEIS CURVOS E PUXADORES USINADOS SÃO INSTALADOS APÓS A MODULAÇÃO COMPLETA FIXADA (EXECUÇÃO EXTERNA).",
    "TODA PEÇA COM AVARIA, OU EM DESACORDO, CONFORME CONTRATO, TEM PRAZO PARA TROCA DE ATÉ 25 DIAS ÚTEIS.",
  ],
};

/** Duração em texto, como no cabeçalho: "3 SEMANAS". */
export function durationText(weeks: number) {
  return weeks === 1 ? "1 SEMANA" : `${weeks} SEMANAS`;
}
