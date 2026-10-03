/**
 * Lembretes do comercial: quem está em aberto e precisa de contato, com o
 * motivo e há quantos dias. Regras puras — a rota e o job diário só buscam os
 * dados e chamam `buildReminders`.
 */

export type ReminderKind =
  | "ACAO_VENCIDA" // próxima ação da oportunidade com data vencida
  | "ORCAMENTO_VENCENDO" // validade do orçamento acabando ou vencida
  | "ORCAMENTO_SEM_RETORNO" // enviado e o cliente não respondeu
  | "ORCAMENTO_PARADO" // rascunho que não foi enviado
  | "LEAD_SEM_CONTATO" // lead novo sem primeiro contato, ou retorno combinado vencido
  | "SEM_CONTATO"; // oportunidade aberta sem interação recente

export type Reminder = {
  kind: ReminderKind;
  label: string;
  /** 1 = mais urgente */
  priority: number;
  sellerId: string | null;
  sellerName: string | null;
  client: string;
  title: string;
  detail: string;
  days: number;
  /** caminho no sistema */
  link: string;
};

export const REMINDER_LABEL: Record<ReminderKind, string> = {
  ACAO_VENCIDA: "Ação vencida",
  ORCAMENTO_VENCENDO: "Orçamento vencendo",
  ORCAMENTO_SEM_RETORNO: "Orçamento sem retorno",
  ORCAMENTO_PARADO: "Orçamento não enviado",
  LEAD_SEM_CONTATO: "Lead sem contato",
  SEM_CONTATO: "Sem contato",
};
const PRIORITY: Record<ReminderKind, number> = { ACAO_VENCIDA: 1, ORCAMENTO_VENCENDO: 2, ORCAMENTO_SEM_RETORNO: 3, LEAD_SEM_CONTATO: 4, ORCAMENTO_PARADO: 5, SEM_CONTATO: 6 };

/** Prazos (dias) que disparam cada lembrete. */
export const REMINDER_DAYS = { quoteNoReply: 3, quoteDraft: 2, quoteExpiring: 2, leadFirstContact: 1, oppNoContact: 7, oppMinAge: 3 };

const DAY = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY);
const plural = (n: number) => (n === 1 ? "1 dia" : `${n} dias`);

type Person = { id: string; name: string } | null;
export type ReminderData = {
  opportunities: { id: string; title: string; createdAt: Date; nextAction: string | null; nextActionAt: Date | null; lastInteractionAt: Date | null; client: string | null; seller: Person }[];
  quotes: { id: string; number: string; version: number; status: string; total: number; createdAt: Date; sentAt: Date | null; updatedAt: Date; validUntil: Date | null; client: string; seller: Person }[];
  leads: { id: string; name: string; enteredAt: Date; lastContactAt: Date | null; nextContactAt: Date | null; seller: Person }[];
};

export function buildReminders(data: ReminderData, now = new Date()): Reminder[] {
  const out: Reminder[] = [];
  const add = (kind: ReminderKind, seller: Person, r: Omit<Reminder, "kind" | "label" | "priority" | "sellerId" | "sellerName">) =>
    out.push({ kind, label: REMINDER_LABEL[kind], priority: PRIORITY[kind], sellerId: seller?.id ?? null, sellerName: seller?.name ?? null, ...r });

  for (const o of data.opportunities) {
    const client = o.client ?? "Sem cliente";
    const link = "/comercial";
    if (o.nextActionAt && o.nextActionAt < now) {
      const d = daysBetween(o.nextActionAt, now);
      add("ACAO_VENCIDA", o.seller, { client, title: o.title, detail: `${o.nextAction ?? "Próxima ação"} — ${d === 0 ? "era para hoje" : `atrasada há ${plural(d)}`}`, days: d, link });
      continue;
    }
    const last = o.lastInteractionAt;
    const age = daysBetween(o.createdAt, now);
    const since = last ? daysBetween(last, now) : age;
    if (age >= REMINDER_DAYS.oppMinAge && since >= REMINDER_DAYS.oppNoContact) {
      add("SEM_CONTATO", o.seller, { client, title: o.title, detail: last ? `Último contato há ${plural(since)}` : `Nenhum contato registrado em ${plural(age)}`, days: since, link });
    }
  }

  for (const q of data.quotes) {
    const name = `${q.number}${q.version > 1 ? ` v${q.version}` : ""}`;
    const link = `/comercial/orcamentos/${q.id}`;
    const sent = ["SENT", "VIEWED", "NEGOTIATION"].includes(q.status);
    if (sent && q.validUntil) {
      const left = Math.ceil((q.validUntil.getTime() - now.getTime()) / DAY);
      if (left <= REMINDER_DAYS.quoteExpiring) {
        add("ORCAMENTO_VENCENDO", q.seller, {
          client: q.client,
          title: `Orçamento ${name}`,
          detail: left < 0 ? `Validade venceu há ${plural(-left)}` : left === 0 ? "Validade vence hoje" : `Validade vence em ${plural(left)}`,
          days: Math.max(0, -left),
          link,
        });
        continue;
      }
    }
    if (sent) {
      const since = daysBetween(q.sentAt ?? q.updatedAt, now);
      if (since >= REMINDER_DAYS.quoteNoReply) add("ORCAMENTO_SEM_RETORNO", q.seller, { client: q.client, title: `Orçamento ${name}`, detail: `Enviado há ${plural(since)} sem resposta do cliente`, days: since, link });
    } else if (q.status === "DRAFT") {
      const since = daysBetween(q.updatedAt, now);
      if (since >= REMINDER_DAYS.quoteDraft) add("ORCAMENTO_PARADO", q.seller, { client: q.client, title: `Orçamento ${name}`, detail: `Rascunho parado há ${plural(since)} — falta enviar ao cliente`, days: since, link });
    }
  }

  for (const l of data.leads) {
    const link = "/comercial?aba=leads";
    if (l.nextContactAt && l.nextContactAt < now) {
      const d = daysBetween(l.nextContactAt, now);
      add("LEAD_SEM_CONTATO", l.seller, { client: l.name, title: "Retorno combinado", detail: d === 0 ? "Retorno era para hoje" : `Retorno atrasado há ${plural(d)}`, days: d, link });
    } else if (!l.lastContactAt && !l.nextContactAt) {
      const d = daysBetween(l.enteredAt, now);
      if (d >= REMINDER_DAYS.leadFirstContact) add("LEAD_SEM_CONTATO", l.seller, { client: l.name, title: "Primeiro contato", detail: `Lead chegou há ${plural(d)} e ainda não foi contatado`, days: d, link });
    }
  }

  return out.sort((a, b) => a.priority - b.priority || b.days - a.days);
}

/** Texto do aviso diário de um vendedor. */
export function digest(reminders: Reminder[]): string {
  const byKind = new Map<string, number>();
  for (const r of reminders) byKind.set(r.label, (byKind.get(r.label) ?? 0) + 1);
  const counts = [...byKind.entries()].map(([l, n]) => `${n} ${l.toLowerCase()}`).join(", ");
  const top = reminders.slice(0, 3).map((r) => `${r.client} (${r.detail})`).join("; ");
  return `${counts}. Comece por: ${top}`;
}
