/**
 * §5 — Indicadores mensais de produtividade, calculados só de dados que o
 * sistema registrou (atividades, apontamento da fábrica, etapas de peça,
 * tarefas e ponto). Nada de nota ou avaliação subjetiva: onde não há dado, o
 * indicador fica nulo e o resumo diz que não há dado — não chuta.
 */
import type { ProductivityMetric } from "@prisma/client";

export type MonthRange = { month: string; start: Date; end: Date };

/** "2026-09" → [01/09 00:00, 01/10 00:00) no horário local do servidor. */
export function monthRange(month: string): MonthRange {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mês inválido (use AAAA-MM)");
  const [y, m] = month.split("-").map(Number);
  return { month, start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function lastMonths(month: string, n: number): string[] {
  const out = [month];
  while (out.length < n) out.unshift(previousMonth(out[0]));
  return out;
}

/** "08:30" → minutos; inválido → null. */
export function hhmm(v: string | null | undefined): number | null {
  const m = v?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export type RawUserMonth = {
  activities: { status: string; startTime: string | null; endTime: string | null }[];
  timeLogs: { minutes: number | null; itemId: string; sector: string }[];
  stepsCompleted: number; // etapas de peça concluídas (evento COMPLETE)
  tasks: { dueAt: Date | null; completedAt: Date | null }[];
  clock: { workedMinutes: number; overtimeMinutes: number; faltas: number } | null; // null = sem vínculo/sem ponto
};

export type Indicators = {
  activitiesDone: number;
  activitiesOpen: number;
  /** Duração média das atividades concluídas com horário de início e fim. */
  avgActivityMinutes: number | null;
  productionMinutes: number;
  productionSteps: number;
  /** Minutos apontados por etapa concluída — o "tempo médio de execução" da fábrica. */
  minutesPerStep: number | null;
  tasksDone: number;
  tasksDoneLate: number;
  tasksOverdueOpen: number;
  /** % de tarefas com prazo concluídas no prazo; null sem tarefa com prazo. */
  onTimeRate: number | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  absences: number | null;
};

const round = (n: number) => Math.round(n);

export function computeIndicators(raw: RawUserMonth, range: MonthRange, now: Date): Indicators {
  const done = raw.activities.filter((a) => a.status === "COMPLETED");
  const durations = done
    .map((a) => {
      const s = hhmm(a.startTime);
      const e = hhmm(a.endTime);
      return s != null && e != null && e > s ? e - s : null;
    })
    .filter((x): x is number => x != null);
  const productionMinutes = raw.timeLogs.reduce((s, l) => s + (l.minutes ?? 0), 0);

  const doneTasks = raw.tasks.filter((t) => t.completedAt && t.completedAt >= range.start && t.completedAt < range.end);
  const late = doneTasks.filter((t) => t.dueAt && t.completedAt! > t.dueAt).length;
  const limite = now < range.end ? now : range.end;
  const overdueOpen = raw.tasks.filter((t) => !t.completedAt && t.dueAt && t.dueAt < limite).length;
  const withDue = doneTasks.filter((t) => t.dueAt).length + overdueOpen;
  const onTime = doneTasks.filter((t) => t.dueAt && t.completedAt! <= t.dueAt).length;

  return {
    activitiesDone: done.length,
    activitiesOpen: raw.activities.filter((a) => a.status === "DRAFT" || a.status === "IN_PROGRESS").length,
    avgActivityMinutes: durations.length ? round(durations.reduce((s, n) => s + n, 0) / durations.length) : null,
    productionMinutes,
    productionSteps: raw.stepsCompleted,
    minutesPerStep: raw.stepsCompleted && productionMinutes ? round(productionMinutes / raw.stepsCompleted) : null,
    tasksDone: doneTasks.length,
    tasksDoneLate: late,
    tasksOverdueOpen: overdueOpen,
    onTimeRate: withDue ? round((onTime / withDue) * 100) : null,
    workedMinutes: raw.clock?.workedMinutes ?? null,
    overtimeMinutes: raw.clock?.overtimeMinutes ?? null,
    absences: raw.clock?.faltas ?? null,
  };
}

export const METRIC_OF: Record<ProductivityMetric, (i: Indicators) => number> = {
  ACTIVITIES_DONE: (i) => i.activitiesDone,
  PRODUCTION_STEPS: (i) => i.productionSteps,
  PRODUCTION_HOURS: (i) => Math.floor(i.productionMinutes / 60),
  TASKS_DONE: (i) => i.tasksDone,
};

export const METRIC_LABEL: Record<ProductivityMetric, string> = {
  ACTIVITIES_DONE: "Atividades concluídas",
  PRODUCTION_STEPS: "Etapas de peça concluídas",
  PRODUCTION_HOURS: "Horas apontadas na produção",
  TASKS_DONE: "Tarefas concluídas",
};

export function goalProgress(goals: { metric: ProductivityMetric; target: number }[], i: Indicators) {
  return goals.map((g) => {
    const actual = METRIC_OF[g.metric](i);
    return { metric: g.metric, label: METRIC_LABEL[g.metric], target: g.target, actual, percent: g.target > 0 ? round((actual / g.target) * 100) : null };
  });
}

/** Houve algum registro no mês? Sem registro, não há o que analisar. */
export const hasData = (i: Indicators) =>
  i.activitiesDone + i.activitiesOpen + i.productionMinutes + i.productionSteps + i.tasksDone + i.tasksOverdueOpen > 0 || (i.workedMinutes ?? 0) > 0;

const h = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
const delta = (cur: number, prev: number) => {
  if (prev === 0) return cur === 0 ? "igual ao mês anterior" : "sem base no mês anterior";
  const p = round(((cur - prev) / prev) * 100);
  return p === 0 ? "igual ao mês anterior" : `${p > 0 ? "+" : ""}${p}% sobre o mês anterior`;
};

/**
 * Resumo mensal em texto a partir dos números — é o que aparece quando não há
 * IA configurada e também o "fato base" que a IA recebe. Só constata; não
 * julga desempenho.
 */
export function factualSummary(name: string, month: string, cur: Indicators, prev: Indicators | null, goals: ReturnType<typeof goalProgress>) {
  if (!hasData(cur)) return { highlights: [] as string[], bottlenecks: [] as string[], text: `${name} não tem registros no sistema em ${month}. Sem dados, não há análise.` };
  const hi: string[] = [];
  const gargalos: string[] = [];
  if (cur.activitiesDone) hi.push(`${cur.activitiesDone} atividade(s) concluída(s)${prev ? ` (${delta(cur.activitiesDone, prev.activitiesDone)})` : ""}`);
  if (cur.productionSteps) hi.push(`${cur.productionSteps} etapa(s) de peça concluída(s) na fábrica${prev ? ` (${delta(cur.productionSteps, prev.productionSteps)})` : ""}`);
  if (cur.productionMinutes) hi.push(`${h(cur.productionMinutes)} apontadas na produção${cur.minutesPerStep ? `, média de ${cur.minutesPerStep} min por etapa` : ""}`);
  if (cur.tasksDone) hi.push(`${cur.tasksDone} tarefa(s) concluída(s)${cur.onTimeRate != null ? `, ${cur.onTimeRate}% no prazo` : ""}`);
  if (cur.workedMinutes != null) hi.push(`${h(cur.workedMinutes)} registradas no ponto${cur.overtimeMinutes ? ` (${h(cur.overtimeMinutes)} além da jornada)` : ""}`);
  for (const g of goals) if (g.percent != null) hi.push(`meta "${g.label}": ${g.actual} de ${g.target} (${g.percent}%)`);

  if (cur.tasksOverdueOpen) gargalos.push(`${cur.tasksOverdueOpen} tarefa(s) com prazo vencido ainda aberta(s)`);
  if (cur.tasksDoneLate) gargalos.push(`${cur.tasksDoneLate} tarefa(s) concluída(s) depois do prazo`);
  if (cur.activitiesOpen) gargalos.push(`${cur.activitiesOpen} atividade(s) sem conclusão registrada`);
  if (cur.absences) gargalos.push(`${cur.absences} dia(s) útil(eis) sem marcação de ponto`);
  if (prev?.minutesPerStep && cur.minutesPerStep && cur.minutesPerStep > prev.minutesPerStep * 1.2) {
    gargalos.push(`tempo por etapa subiu de ${prev.minutesPerStep} para ${cur.minutesPerStep} min`);
  }
  const text = [`Em ${month}, ${name}: ${hi.join("; ")}.`, gargalos.length ? `Pontos de atenção: ${gargalos.join("; ")}.` : "Nenhum atraso registrado no período."].join(" ");
  return { highlights: hi, bottlenecks: gargalos, text };
}
