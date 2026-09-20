/**
 * Produtividade dos montadores por cômodo.
 *
 * META PRÓPRIA: a meta de cada montador é a MEDIANA do tempo que ELE MESMO
 * levou nos últimos cômodos do mesmo tipo (aprovados pela gestão). Assim ninguém
 * é comparado com um colega mais experiente — o bônus premia quem supera o
 * próprio ritmo. Enquanto não houver cômodos suficientes do tipo, não há meta.
 *
 * Mediana (e não média) para um cômodo que deu problema não puxar a meta.
 */
import { InvalidStateError } from "../../utils/ApiError";

export const ROOM_TYPES = [
  "COZINHA",
  "BANHEIRO",
  "LAVABO",
  "DORMITORIO",
  "CLOSET",
  "SALA",
  "HOME_OFFICE",
  "LAVANDERIA",
  "AREA_GOURMET",
  "VARANDA",
  "CORREDOR",
  "OUTRO",
] as const;
export type RoomTypeKey = (typeof ROOM_TYPES)[number];

export const ROOM_LABEL: Record<RoomTypeKey, string> = {
  COZINHA: "Cozinha",
  BANHEIRO: "Banheiro",
  LAVABO: "Lavabo",
  DORMITORIO: "Dormitório",
  CLOSET: "Closet",
  SALA: "Sala",
  HOME_OFFICE: "Home office",
  LAVANDERIA: "Lavanderia",
  AREA_GOURMET: "Área gourmet",
  VARANDA: "Varanda",
  CORREDOR: "Corredor / hall",
  OUTRO: "Outro",
};

/** Quantos cômodos recentes entram no cálculo da meta. */
export const TARGET_WINDOW = 10;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Tipo de cômodo a partir do nome do ambiente (Promob ou digitado).
 * Ordem importa: "banheiro da suíte" é banheiro, não dormitório.
 */
export function classifyRoom(name: string | null | undefined): RoomTypeKey {
  const s = normalize(name ?? "");
  if (!s.trim()) return "OUTRO";
  const rules: [RegExp, RoomTypeKey][] = [
    [/\blavabo\b/, "LAVABO"],
    [/\b(banheiro|bwc|wc|toalete|sanitario)\b/, "BANHEIRO"],
    [/\b(lavanderia|area de servico|servico)\b/, "LAVANDERIA"],
    [/\b(gourmet|churrasqueira|espaco gourmet)\b/, "AREA_GOURMET"],
    [/\b(cozinha|copa)\b/, "COZINHA"],
    [/\bcloset\b/, "CLOSET"],
    [/\b(home office|escritorio|estudo)\b/, "HOME_OFFICE"],
    [/\b(varanda|sacada|terraco)\b/, "VARANDA"],
    [/\b(corredor|hall|circulacao)\b/, "CORREDOR"],
    [/\b(dormitorio|quarto|suite|dorm)\b/, "DORMITORIO"],
    [/\b(sala|living|estar|jantar|tv|home theater)\b/, "SALA"],
  ];
  for (const [re, type] of rules) if (re.test(s)) return type;
  return "OUTRO";
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Percentil (0–100) por interpolação linear. */
export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = (Math.min(Math.max(p, 0), 100) / 100) * (v.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

/**
 * Meta própria em minutos: mediana dos últimos `TARGET_WINDOW` cômodos do mesmo
 * tipo (mais recentes primeiro). `null` se ainda não há `minSamples`.
 */
export function ownTargetMinutes(historyNewestFirst: number[], minSamples: number): number | null {
  const valid = historyNewestFirst.filter((m) => Number.isFinite(m) && m > 0).slice(0, TARGET_WINDOW);
  if (valid.length < Math.max(1, minSamples)) return null;
  return Math.round(median(valid)!);
}

/** Ganho sobre a meta em %: positivo = mais rápido que o próprio ritmo. */
export function gainPct(targetMinutes: number, actualMinutes: number) {
  if (targetMinutes <= 0) return 0;
  return Math.round(((targetMinutes - actualMinutes) / targetMinutes) * 10000) / 100;
}

export type BonusTier = { minGainPct: number; amount: number };

/** Normaliza e valida as faixas (ordem crescente, sem repetição, valores positivos). */
export function normalizeTiers(tiers: BonusTier[]): BonusTier[] {
  const clean = tiers
    .map((t) => ({ minGainPct: Number(t.minGainPct), amount: Number(t.amount) }))
    .filter((t) => Number.isFinite(t.minGainPct) && Number.isFinite(t.amount));
  for (const t of clean) {
    if (t.minGainPct <= 0 || t.minGainPct >= 100) throw new InvalidStateError("Cada faixa precisa de um ganho entre 0% e 100%");
    if (t.amount <= 0) throw new InvalidStateError("O valor do bônus de cada faixa precisa ser maior que zero");
  }
  const sorted = clean.sort((a, b) => a.minGainPct - b.minGainPct);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minGainPct === sorted[i - 1].minGainPct) throw new InvalidStateError("Há duas faixas com o mesmo ganho mínimo");
    if (sorted[i].amount < sorted[i - 1].amount) throw new InvalidStateError("Faixa de ganho maior não pode pagar menos que a anterior");
  }
  return sorted;
}

/** Valor da maior faixa atingida (0 se não chegou na primeira). */
export function bonusForGain(gain: number, tiers: BonusTier[]) {
  let amount = 0;
  for (const t of [...tiers].sort((a, b) => a.minGainPct - b.minGainPct)) {
    if (gain >= t.minGainPct) amount = t.amount;
  }
  return amount;
}

/** Aplica o teto mensal (se houver) ao bônus. */
export function capBonus(amount: number, alreadyThisMonth: number, maxPerMonth: number | null) {
  if (maxPerMonth === null || maxPerMonth === undefined) return amount;
  return Math.max(0, Math.min(amount, maxPerMonth - alreadyThisMonth));
}

export type TaskLog = { startedAt: Date; endedAt: Date | null };

/** Minutos de um intervalo (fechado com `now` se ainda aberto). */
export function logMinutes(log: TaskLog, now = new Date()) {
  const end = log.endedAt ?? now;
  return Math.max(0, Math.round((end.getTime() - log.startedAt.getTime()) / 60000));
}

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "PAUSED" | "DONE" | "CANCELLED";

/** Transições permitidas do cronômetro do cômodo. */
export function assertTaskTransition(from: TaskStatus, action: "start" | "pause" | "finish") {
  const allowed: Record<typeof action, TaskStatus[]> = {
    start: ["PENDING", "PAUSED"],
    pause: ["IN_PROGRESS"],
    finish: ["IN_PROGRESS", "PAUSED"],
  };
  if (!allowed[action].includes(from)) {
    const label: Record<TaskStatus, string> = {
      PENDING: "não iniciado",
      IN_PROGRESS: "em andamento",
      PAUSED: "pausado",
      DONE: "concluído",
      CANCELLED: "cancelado",
    };
    const verb = { start: "iniciar", pause: "pausar", finish: "concluir" }[action];
    throw new InvalidStateError(`Não dá para ${verb} um cômodo ${label[from]}`);
  }
}

export type ReportTask = {
  contractorId: string;
  contractorName: string;
  roomType: RoomTypeKey;
  workedMinutes: number;
  targetMinutes: number | null;
  finishedAt: Date | null;
  bonusAmount: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Relatório de produtividade: por montador e tipo de cômodo, com a mediana da
 * equipe como referência (só referência — a meta de cada um é a própria).
 * Recebe apenas cômodos concluídos e aprovados.
 */
export function buildProductivityReport(tasks: ReportTask[]) {
  const teamByRoom = new Map<RoomTypeKey, number[]>();
  for (const t of tasks) teamByRoom.set(t.roomType, [...(teamByRoom.get(t.roomType) ?? []), t.workedMinutes]);

  const byContractor = new Map<string, { name: string; tasks: ReportTask[] }>();
  for (const t of tasks) {
    const row = byContractor.get(t.contractorId) ?? { name: t.contractorName, tasks: [] };
    row.tasks.push(t);
    byContractor.set(t.contractorId, row);
  }

  const contractors = [...byContractor.entries()]
    .map(([contractorId, { name, tasks: list }]) => {
      const rooms = new Map<RoomTypeKey, ReportTask[]>();
      for (const t of list) rooms.set(t.roomType, [...(rooms.get(t.roomType) ?? []), t]);
      const gains = list.filter((t) => t.targetMinutes && t.targetMinutes > 0).map((t) => gainPct(t.targetMinutes!, t.workedMinutes));
      return {
        contractorId,
        name,
        rooms: list.length,
        hours: round1(list.reduce((a, t) => a + t.workedMinutes, 0) / 60),
        avgGainPct: gains.length ? round1(gains.reduce((a, g) => a + g, 0) / gains.length) : null,
        roomsAboveTarget: gains.filter((g) => g > 0).length,
        bonusTotal: Math.round(list.reduce((a, t) => a + t.bonusAmount, 0) * 100) / 100,
        byRoom: [...rooms.entries()]
          .map(([roomType, rs]) => {
            const minutes = rs.map((r) => r.workedMinutes);
            const g = rs.filter((r) => r.targetMinutes && r.targetMinutes > 0).map((r) => gainPct(r.targetMinutes!, r.workedMinutes));
            return {
              roomType,
              label: ROOM_LABEL[roomType],
              count: rs.length,
              medianMinutes: Math.round(median(minutes)!),
              bestMinutes: Math.min(...minutes),
              teamMedianMinutes: Math.round(median(teamByRoom.get(roomType) ?? [])!),
              avgGainPct: g.length ? round1(g.reduce((a, x) => a + x, 0) / g.length) : null,
            };
          })
          .sort((a, b) => b.count - a.count),
      };
    })
    .sort((a, b) => b.rooms - a.rooms || a.name.localeCompare(b.name));

  const team = [...teamByRoom.entries()]
    .map(([roomType, minutes]) => ({
      roomType,
      label: ROOM_LABEL[roomType],
      count: minutes.length,
      medianMinutes: Math.round(median(minutes)!),
      p80Minutes: Math.round(percentile(minutes, 80)!),
    }))
    .sort((a, b) => b.count - a.count);

  return { contractors, team };
}

/**
 * Bônus de um cômodo aprovado. Retorna null quando não gera bônus e o motivo,
 * para a tela explicar ao montador.
 */
export function evaluateBonus(opts: {
  policyEnabled: boolean;
  tiers: BonusTier[];
  targetMinutes: number | null;
  actualMinutes: number;
  alreadyThisMonth: number;
  maxPerMonth: number | null;
}): { amount: number; gain: number | null; reason: string } {
  if (!opts.policyEnabled) return { amount: 0, gain: null, reason: "Bonificação desligada" };
  if (opts.targetMinutes === null) return { amount: 0, gain: null, reason: "Ainda sem meta própria para este tipo de cômodo" };
  if (opts.actualMinutes <= 0) return { amount: 0, gain: null, reason: "Tempo trabalhado não registrado" };
  const gain = gainPct(opts.targetMinutes, opts.actualMinutes);
  const raw = bonusForGain(gain, opts.tiers);
  if (raw <= 0) return { amount: 0, gain, reason: gain > 0 ? "Mais rápido, mas abaixo da primeira faixa" : "Dentro ou acima da própria meta" };
  const amount = capBonus(raw, opts.alreadyThisMonth, opts.maxPerMonth);
  if (amount <= 0) return { amount: 0, gain, reason: "Teto mensal de bônus atingido" };
  return { amount, gain, reason: amount < raw ? "Bônus limitado pelo teto mensal" : "Superou a própria meta" };
}
