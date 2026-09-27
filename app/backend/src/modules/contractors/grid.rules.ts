/**
 * Grade de montagem: montadores nas linhas, dias nas colunas. Cada requisição
 * ocupa `days` dias a partir da data prevista, para o titular e os ajudantes.
 * Duas montagens no mesmo dia para a mesma pessoa = conflito (aviso, não trava).
 */

export type GridOrder = {
  id: string;
  number: string;
  status: string;
  kind: string;
  contractorId: string;
  helperIds: string[];
  /** aaaa-mm-dd */
  startDay: string;
  days: number;
  label: string;
};

export type GridCell = { orderId: string; number: string; label: string; kind: string; status: string; role: "TITULAR" | "AJUDANTE" };

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayRange(from: string, count: number) {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

/** Dias que a requisição ocupa. */
export const occupiedDays = (o: Pick<GridOrder, "startDay" | "days">) => dayRange(o.startDay, Math.max(1, o.days));

export function buildGrid(people: { id: string }[], orders: GridOrder[], from: string, count: number) {
  const days = dayRange(from, count);
  const inRange = new Set(days);
  const grid = new Map<string, Map<string, GridCell[]>>(people.map((p) => [p.id, new Map(days.map((d) => [d, []]))]));
  for (const o of orders) {
    const crew: [string, GridCell["role"]][] = [[o.contractorId, "TITULAR"], ...o.helperIds.map((h) => [h, "AJUDANTE"] as [string, GridCell["role"]])];
    for (const day of occupiedDays(o)) {
      if (!inRange.has(day)) continue;
      for (const [pid, role] of crew) {
        grid.get(pid)?.get(day)?.push({ orderId: o.id, number: o.number, label: o.label, kind: o.kind, status: o.status, role });
      }
    }
  }
  const rows = people.map((p) => ({
    contractorId: p.id,
    cells: days.map((d) => ({ day: d, items: grid.get(p.id)!.get(d)!, conflict: grid.get(p.id)!.get(d)!.filter((c) => c.status !== "CANCELLED").length > 1 })),
  }));
  return { days, rows, conflicts: rows.reduce((s, r) => s + r.cells.filter((c) => c.conflict).length, 0) };
}

/** Quem da equipe já está ocupado em algum dos dias desta requisição (outras requisições). */
export function crewConflicts(target: Pick<GridOrder, "id" | "contractorId" | "helperIds" | "startDay" | "days">, others: GridOrder[]) {
  const crew = new Set([target.contractorId, ...target.helperIds]);
  const mine = new Set(occupiedDays(target));
  const out: { personId: string; day: string; number: string }[] = [];
  for (const o of others) {
    if (o.id === target.id || o.status === "CANCELLED") continue;
    const theirs = [o.contractorId, ...o.helperIds].filter((p) => crew.has(p));
    if (!theirs.length) continue;
    for (const d of occupiedDays(o)) if (mine.has(d)) for (const p of theirs) out.push({ personId: p, day: d, number: o.number });
  }
  return out;
}
