/**
 * "Semana da Mobieer": o planejamento da semana montado com o que está no
 * sistema — checklist por área (Comercial, Produção, Instalações, Follow-up e
 * Assistência), as três prioridades, o que pode travar entrega e a agenda de
 * segunda a sexta (sábado só quando há montagem ou compromisso).
 *
 * Regra de ouro: só entra o que tem registro. Dado que falta (data, responsável)
 * aparece como "a confirmar"; nada é inventado. Regras puras.
 */

export type AreaKey = "COMERCIAL" | "PRODUCAO" | "INSTALACOES" | "FOLLOWUP" | "ASSISTENCIA";
export const AREA_LABEL: Record<AreaKey, string> = {
  COMERCIAL: "Comercial",
  PRODUCAO: "Produção",
  INSTALACOES: "Instalações",
  FOLLOWUP: "Follow-up",
  ASSISTENCIA: "Assistência",
};

export type WeeklyItem = {
  id: string;
  area: AreaKey;
  title: string;
  detail: string;
  client: string | null;
  responsible: string | null;
  /** aaaa-mm-dd */
  due: string | null;
  confirmed: boolean;
  critical: boolean;
  /** maior = mais urgente (ordena as prioridades) */
  weight: number;
  link: string | null;
};

export type AgendaEntry = { date: string; time: string | null; title: string; kind: string; confirmed: boolean; link: string | null };

export type WeeklySnapshot = {
  /** segunda-feira da semana, aaaa-mm-dd */
  weekStart: string;
  now: Date;
  followups: { kind: string; label: string; client: string; title?: string; detail: string; days: number; sellerName: string | null; link: string; priority: number }[];
  approvals: { id: string; number: string; client: string; seller: string | null; total: number }[];
  measurements: { id: string; project: string; client: string | null; scheduledAt: Date | null; technician: string | null; status: string; clientConfirmed: boolean }[];
  production: { projectId: string; project: string; client: string | null; stage: string; stageLabel: string; estimatedDeliveryAt: Date | null; missing: number; total: number }[];
  workOrders: { id: string; number: string; project: string; projectId: string; client: string | null; contractor: string | null; scheduledFor: Date | null; days: number }[];
  assistance: { id: string; number: string; title: string; client: string | null; status: string; priority: string; scheduledAt: Date | null; clientConfirmed: boolean; assignee: string | null; dueAt: Date | null }[];
  agenda: { id: string; title: string; startAt: Date; allDay: boolean; client: string | null; responsible: string | null }[];
};

const TZ = "America/Fortaleza";
const DAY = 86_400_000;
const localDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const localTime = (d: Date) => d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** Segunda-feira da semana de uma data (no fuso da loja). */
export function mondayOf(d: Date): string {
  const iso = localDay(d);
  const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((wd + 6) % 7));
}

const inWeek = (iso: string | null, start: string) => iso != null && iso >= start && iso <= addDays(start, 6);

export function buildWeekly(s: WeeklySnapshot) {
  const start = s.weekStart;
  const end = addDays(start, 5); // sábado
  const today = localDay(s.now);
  const items: WeeklyItem[] = [];
  const agenda: AgendaEntry[] = [];
  const add = (it: Omit<WeeklyItem, "id"> & { id?: string }) => items.push({ id: it.id ?? `${it.area}-${items.length}`, ...it });

  // ---- Follow-up e Comercial (lembretes do comercial)
  for (const f of s.followups) {
    const commercial = f.kind.startsWith("ORCAMENTO");
    add({
      area: commercial ? "COMERCIAL" : "FOLLOWUP",
      // oportunidade ainda sem cliente: o nome da oportunidade diz do que se trata
      title: `${f.label}: ${f.client === "Sem cliente" && f.title ? f.title : f.client}`,
      detail: f.detail,
      client: f.client,
      responsible: f.sellerName,
      due: null,
      confirmed: true,
      critical: f.priority <= 2 || f.days >= 7,
      weight: 60 - f.priority * 5 + Math.min(f.days, 30),
      link: f.link,
    });
  }
  for (const q of s.approvals) {
    add({ id: `apr-${q.id}`, area: "COMERCIAL", title: `Liberar orçamento ${q.number}: ${q.client}`, detail: `Mark-up abaixo do mínimo — ${brl(q.total)} aguardando liberação`, client: q.client, responsible: q.seller, due: null, confirmed: true, critical: true, weight: 80, link: `/comercial/orcamentos/${q.id}` });
  }
  for (const m of s.measurements) {
    const day = m.scheduledAt ? localDay(m.scheduledAt) : null;
    if (m.status === "SCHEDULED" && day && !inWeek(day, start) && day > end) continue;
    const confirmed = m.status === "SCHEDULED" && m.clientConfirmed;
    add({
      id: `med-${m.id}`,
      area: "COMERCIAL",
      title: `Medição ${m.project}${m.client ? ` — ${m.client}` : ""}`,
      detail: m.status === "REQUESTED" ? "Cliente pediu a medição: marcar data e técnico" : confirmed ? `Agendada para ${localTime(m.scheduledAt!)}` : "Agendada — cliente ainda não confirmou",
      client: m.client,
      responsible: m.technician,
      due: day,
      confirmed,
      critical: m.status === "REQUESTED",
      weight: m.status === "REQUESTED" ? 55 : 30,
      link: "/medicoes",
    });
    if (day && inWeek(day, start)) agenda.push({ date: day, time: localTime(m.scheduledAt!), title: `Medição ${m.project}${m.technician ? ` (${m.technician})` : ""}`, kind: "MEDICAO", confirmed, link: "/medicoes" });
  }

  // ---- Produção: entrega da semana, atrasada ou com peça sem baixa
  for (const p of s.production) {
    const due = p.estimatedDeliveryAt ? localDay(p.estimatedDeliveryAt) : null;
    const late = due != null && due < today;
    const thisWeek = inWeek(due, start);
    if (!late && !thisWeek && p.missing === 0 && due != null) continue;
    add({
      id: `prod-${p.projectId}`,
      area: "PRODUCAO",
      title: `${p.project}${p.client ? ` — ${p.client}` : ""}: ${p.stageLabel}`,
      detail: [
        due ? (late ? `entrega prevista para ${due.split("-").reverse().join("/")} — atrasada` : `entrega prevista para ${due.split("-").reverse().join("/")}`) : "previsão de entrega a confirmar",
        p.total > 0 ? `${p.missing} de ${p.total} itens sem baixa` : null,
      ].filter(Boolean).join(" · "),
      client: p.client,
      responsible: null,
      due,
      confirmed: due != null,
      critical: late || (thisWeek && p.missing > 0),
      weight: late ? 100 : thisWeek ? 70 : 25,
      link: `/clientes-projetos/${p.projectId}`,
    });
    if (thisWeek) agenda.push({ date: due!, time: null, title: `Entrega prevista ${p.project}`, kind: "ENTREGA", confirmed: true, link: `/clientes-projetos/${p.projectId}` });
  }

  // ---- Instalações: montagens da semana (e as sem data)
  for (const o of s.workOrders) {
    const day = o.scheduledFor ? localDay(o.scheduledFor) : null;
    if (day && day > end) continue;
    add({
      id: `os-${o.id}`,
      area: "INSTALACOES",
      title: `Montagem ${o.project}${o.client ? ` — ${o.client}` : ""}`,
      detail: day ? `${day.split("-").reverse().join("/")}${o.days > 1 ? ` (${o.days} dias)` : ""} · requisição ${o.number}` : `Requisição ${o.number} sem data — agendar`,
      client: o.client,
      responsible: o.contractor,
      due: day,
      confirmed: day != null,
      critical: day == null || (day < today),
      weight: day == null ? 50 : day < today ? 75 : 45,
      link: "/montadores",
    });
    if (day) {
      for (let i = 0, d = day; i < Math.max(1, o.days); d = addDays(d, 1)) {
        const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
        if (wd === 0) continue; // domingo não conta
        if (inWeek(d, start)) agenda.push({ date: d, time: null, title: `Montagem ${o.project}${o.contractor ? ` (${o.contractor})` : ""}`, kind: "MONTAGEM", confirmed: true, link: "/montadores" });
        i++;
      }
    }
  }

  // ---- Assistência
  for (const a of s.assistance) {
    const day = a.scheduledAt ? localDay(a.scheduledAt) : null;
    const urgent = a.priority === "URGENT" || a.priority === "HIGH";
    add({
      id: `at-${a.id}`,
      area: "ASSISTENCIA",
      title: `${a.number} ${a.title}${a.client ? ` — ${a.client}` : ""}`,
      detail: day ? `Visita em ${day.split("-").reverse().join("/")}${a.clientConfirmed ? "" : " — cliente ainda não confirmou"}` : a.status === "WAITING_CLIENT" ? "Aguardando o cliente" : "Sem visita marcada — enviar datas ao cliente",
      client: a.client,
      responsible: a.assignee,
      due: day,
      confirmed: day != null && a.clientConfirmed,
      critical: urgent || (a.dueAt != null && localDay(a.dueAt) < today),
      weight: urgent ? 65 : day ? 35 : 40,
      link: "/clientes-projetos",
    });
    if (day && inWeek(day, start)) agenda.push({ date: day, time: localTime(a.scheduledAt!), title: `Assistência ${a.number}${a.client ? ` — ${a.client}` : ""}`, kind: "ASSISTENCIA", confirmed: a.clientConfirmed, link: "/clientes-projetos" });
  }

  // ---- Agenda geral
  for (const e of s.agenda) {
    const day = localDay(e.startAt);
    if (!inWeek(day, start)) continue;
    agenda.push({ date: day, time: e.allDay ? null : localTime(e.startAt), title: `${e.title}${e.responsible ? ` (${e.responsible})` : ""}`, kind: "AGENDA", confirmed: true, link: "/agenda" });
  }

  // dias: segunda a sexta; sábado só com algo marcado
  const saturday = agenda.some((a) => a.date === end);
  const days = Array.from({ length: saturday ? 6 : 5 }, (_, i) => {
    const date = addDays(start, i);
    return {
      date,
      label: `${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${date.slice(8)}/${date.slice(5, 7)}`,
      entries: agenda.filter((a) => a.date === date).sort((x, y) => (x.time ?? "00:00").localeCompare(y.time ?? "00:00")),
    };
  });

  const sorted = [...items].sort((a, b) => b.weight - a.weight);
  const areas = (Object.keys(AREA_LABEL) as AreaKey[]).map((key) => ({ key, label: AREA_LABEL[key], items: sorted.filter((i) => i.area === key) }));
  return {
    weekStart: start,
    weekEnd: addDays(start, 4),
    priorities: sorted.filter((i) => i.critical).slice(0, 3),
    blockers: sorted.filter((i) => i.area === "PRODUCAO" && i.critical),
    toConfirm: sorted.filter((i) => !i.confirmed).length,
    areas,
    days,
    total: items.length,
  };
}

/** Texto curto do aviso de segunda-feira. */
export function weeklyDigest(w: ReturnType<typeof buildWeekly>) {
  const counts = w.areas.filter((a) => a.items.length).map((a) => `${a.label} ${a.items.length}`).join(" · ");
  const top = w.priorities.map((p, i) => `${i + 1}) ${p.title}`).join("  ");
  return `${counts || "Nada pendente registrado"}.${top ? ` Prioridades: ${top}` : ""}`;
}
