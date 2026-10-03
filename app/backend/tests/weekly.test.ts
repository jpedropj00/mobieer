/**
 * Semana da Mobieer: checklist por área, prioridades, agenda e "a confirmar".
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildWeekly, mondayOf, weeklyDigest, type WeeklySnapshot } from "../src/modules/weekly/weekly.rules";

// segunda 05/10/2026, 8h em Fortaleza
const now = new Date("2026-10-05T11:00:00Z");
const at = (iso: string, h = 12) => new Date(`${iso}T${String(h + 3).padStart(2, "0")}:00:00Z`); // h = hora local
const empty: WeeklySnapshot = { weekStart: "2026-10-05", now, followups: [], approvals: [], measurements: [], production: [], workOrders: [], assistance: [], agenda: [] };

test("segunda-feira da semana, no fuso da loja", () => {
  assert.equal(mondayOf(new Date("2026-10-08T15:00:00Z")), "2026-10-05");
  assert.equal(mondayOf(new Date("2026-10-05T02:00:00Z")), "2026-09-28"); // domingo 23h em Fortaleza
  assert.equal(mondayOf(now), "2026-10-05");
});

test("prioridades: produção atrasada, liberação de orçamento e assistência urgente vêm antes", () => {
  const w = buildWeekly({
    ...empty,
    production: [
      { projectId: "p1", project: "402-1", client: "Juliana", stage: "IN_PRODUCTION", stageLabel: "Em produção", estimatedDeliveryAt: at("2026-10-01"), missing: 12, total: 40 },
      { projectId: "p2", project: "410-1", client: "Ana", stage: "IN_PRODUCTION", stageLabel: "Em produção", estimatedDeliveryAt: at("2026-11-20"), missing: 0, total: 30 },
    ],
    approvals: [{ id: "q1", number: "ORC-00007", client: "Rui", seller: "Joana", total: 9000 }],
    assistance: [{ id: "a1", number: "AT-0003", title: "Porta desalinhada", client: "Bia", status: "OPEN", priority: "URGENT", scheduledAt: null, clientConfirmed: false, assignee: null, dueAt: null }],
  });
  assert.deepEqual(w.priorities.map((p) => p.id), ["prod-p1", "apr-q1", "at-a1"]);
  assert.equal(w.priorities[0].detail, "entrega prevista para 01/10/2026 — atrasada · 12 de 40 itens sem baixa");
  // 410-1 entrega daqui a semanas e sem pendência: não polui a semana
  assert.equal(w.areas.find((a) => a.key === "PRODUCAO")!.items.length, 1);
  assert.deepEqual(w.blockers.map((b) => b.id), ["prod-p1"]);
});

test("agenda: segunda a sexta; montagem de 2 dias ocupa os dois; sábado só quando tem algo", () => {
  const w = buildWeekly({
    ...empty,
    workOrders: [{ id: "o1", number: "OS-0004", project: "402-1", projectId: "p1", client: "Juliana", contractor: "Gledson", scheduledFor: at("2026-10-07", 8), days: 2 }],
    measurements: [{ id: "m1", project: "411-1", client: "Caio", scheduledAt: at("2026-10-06", 9), technician: "Marcos", status: "SCHEDULED", clientConfirmed: false }],
  });
  assert.equal(w.days.length, 5);
  assert.deepEqual(w.days.map((d) => d.entries.map((e) => e.kind)), [[], ["MEDICAO"], ["MONTAGEM"], ["MONTAGEM"], []]);
  assert.equal(w.days[1].entries[0].time, "09:00");
  assert.equal(w.days[1].entries[0].confirmed, false); // cliente ainda não confirmou a medição
  assert.equal(w.toConfirm, 1);

  const sat = buildWeekly({ ...empty, workOrders: [{ id: "o2", number: "OS-0005", project: "420-1", projectId: "p3", client: null, contractor: null, scheduledFor: at("2026-10-09", 8), days: 2 }] });
  assert.equal(sat.days.length, 6);
  assert.equal(sat.days[5].label, "Sábado 10/10");
});

test("montagem sem data vira 'agendar' e entra como a confirmar; aviso de segunda resume", () => {
  const w = buildWeekly({
    ...empty,
    workOrders: [{ id: "o3", number: "OS-0006", project: "430-1", projectId: "p4", client: "Leo", contractor: null, scheduledFor: null, days: 1 }],
    followups: [{ kind: "LEAD_SEM_CONTATO", label: "Lead sem contato", client: "Duda", detail: "Lead chegou há 2 dias", days: 2, sellerName: "Ana", link: "/comercial?aba=leads", priority: 4 }],
  });
  const inst = w.areas.find((a) => a.key === "INSTALACOES")!.items[0];
  assert.equal(inst.detail, "Requisição OS-0006 sem data — agendar");
  assert.equal(inst.confirmed, false);
  assert.equal(w.areas.find((a) => a.key === "FOLLOWUP")!.items[0].responsible, "Ana");
  assert.equal(weeklyDigest(w), "Instalações 1 · Follow-up 1. Prioridades: 1) Montagem 430-1 — Leo");
  assert.equal(weeklyDigest(buildWeekly(empty)), "Nada pendente registrado.");
});
