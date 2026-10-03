/**
 * Lembretes do comercial e meta sugerida pelas despesas fixas.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildReminders, digest, type ReminderData } from "../src/modules/commercial/reminders.rules";
import { marginFromMarkup, suggestGoal } from "../src/modules/commercial/goal-suggestion.rules";

const now = new Date("2026-10-10T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
const ana = { id: "u1", name: "Ana" };
const empty: ReminderData = { opportunities: [], quotes: [], leads: [] };

test("oportunidade: ação vencida ganha de 'sem contato'; recente não lembra", () => {
  const r = buildReminders(
    {
      ...empty,
      opportunities: [
        { id: "o1", title: "Cozinha", createdAt: ago(20), nextAction: "Ligar", nextActionAt: ago(2), lastInteractionAt: ago(1), client: "Maria", seller: ana },
        { id: "o2", title: "Closet", createdAt: ago(20), nextAction: null, nextActionAt: null, lastInteractionAt: ago(9), client: "João", seller: ana },
        { id: "o3", title: "Sala", createdAt: ago(20), nextAction: null, nextActionAt: null, lastInteractionAt: ago(2), client: "Bia", seller: ana },
        { id: "o4", title: "Nova", createdAt: ago(1), nextAction: null, nextActionAt: null, lastInteractionAt: null, client: null, seller: ana },
      ],
    },
    now
  );
  assert.deepEqual(r.map((x) => [x.kind, x.client, x.detail]), [
    ["ACAO_VENCIDA", "Maria", "Ligar — atrasada há 2 dias"],
    ["SEM_CONTATO", "João", "Último contato há 9 dias"],
  ]);
});

test("orçamento: vencendo, sem retorno e rascunho parado; aceito não lembra", () => {
  const q = (o: Partial<ReminderData["quotes"][number]>) => ({ id: "q", number: "ORC-00001", version: 1, status: "SENT", total: 1000, createdAt: ago(10), sentAt: ago(5), updatedAt: ago(5), validUntil: new Date(now.getTime() + 20 * 86_400_000), client: "Maria", seller: ana, ...o });
  const r = buildReminders(
    {
      ...empty,
      quotes: [
        q({ id: "a" }),
        q({ id: "b", number: "ORC-00002", validUntil: new Date(now.getTime() + 86_400_000) }),
        q({ id: "c", number: "ORC-00003", validUntil: ago(3) }),
        q({ id: "d", number: "ORC-00004", status: "DRAFT", sentAt: null, updatedAt: ago(4) }),
        q({ id: "e", number: "ORC-00005", status: "APPROVED" }),
        q({ id: "f", number: "ORC-00006", sentAt: ago(1), updatedAt: ago(1) }),
      ],
    },
    now
  );
  assert.deepEqual(r.map((x) => [x.kind, x.title, x.detail]), [
    ["ORCAMENTO_VENCENDO", "Orçamento ORC-00003", "Validade venceu há 3 dias"],
    ["ORCAMENTO_VENCENDO", "Orçamento ORC-00002", "Validade vence em 1 dia"],
    ["ORCAMENTO_SEM_RETORNO", "Orçamento ORC-00001", "Enviado há 5 dias sem resposta do cliente"],
    ["ORCAMENTO_PARADO", "Orçamento ORC-00004", "Rascunho parado há 4 dias — falta enviar ao cliente"],
  ]);
  assert.equal(r[0].link, "/comercial/orcamentos/c");
});

test("lead: primeiro contato e retorno combinado; aviso diário resume e aponta por onde começar", () => {
  const r = buildReminders(
    {
      ...empty,
      leads: [
        { id: "l1", name: "Carla", enteredAt: ago(2), lastContactAt: null, nextContactAt: null, seller: ana },
        { id: "l2", name: "Duda", enteredAt: ago(9), lastContactAt: ago(8), nextContactAt: ago(1), seller: null },
        { id: "l3", name: "Hoje", enteredAt: ago(0), lastContactAt: null, nextContactAt: null, seller: ana },
      ],
    },
    now
  );
  assert.deepEqual(r.map((x) => [x.client, x.detail]), [["Carla", "Lead chegou há 2 dias e ainda não foi contatado"], ["Duda", "Retorno atrasado há 1 dia"]]);
  assert.equal(digest(r), "2 lead sem contato. Comece por: Carla (Lead chegou há 2 dias e ainda não foi contatado); Duda (Retorno atrasado há 1 dia)");
});

test("margem teórica: mark-up 1,67 e 3% de comissão", () => {
  assert.equal(marginFromMarkup(1.67, 3), 38.92);
  assert.equal(marginFromMarkup(1, 0), 0);
});

test("meta sugerida: equilíbrio, recomendada com lucro e desafio; contratos pelo ticket médio", () => {
  const s = suggestGoal({ fixedCosts: 40_000, marginPercent: 40, profitPercent: 20, avgTicket: 25_000, sellers: [{ id: "a", name: "Ana", sold: 60_000 }, { id: "b", name: "Rui", sold: 20_000 }] });
  assert.equal(s.ok, true);
  if (!s.ok) return;
  assert.equal(s.breakEven, 100_000); // 40.000 ÷ 0,40
  assert.equal(s.recommended, 120_000); // (40.000 × 1,2) ÷ 0,40
  assert.equal(s.stretch, 150_000);
  assert.equal(s.expectedProfit, 8_000); // 120.000 × 0,40 − 40.000
  assert.deepEqual(s.contracts, { breakEven: 4, recommended: 5, stretch: 6 });
  assert.deepEqual(s.bySeller, [{ id: "a", name: "Ana", sharePercent: 75, suggested: 90_000 }, { id: "b", name: "Rui", sharePercent: 25, suggested: 30_000 }]);
  assert.equal(s.sellersBasis, "HISTORY");
});

test("sem histórico divide igual; sem despesas fixas explica o que falta", () => {
  const s = suggestGoal({ fixedCosts: 30_000, marginPercent: 30, profitPercent: 0, avgTicket: null, sellers: [{ id: "a", name: "Ana", sold: 0 }, { id: "b", name: "Rui", sold: 0 }] });
  if (!s.ok) throw new Error("esperava sugestão");
  assert.equal(s.breakEven, 100_000);
  assert.equal(s.recommended, 100_000);
  assert.deepEqual(s.bySeller.map((x) => x.suggested), [50_000, 50_000]);
  assert.equal(s.contracts.recommended, null);
  const none = suggestGoal({ fixedCosts: 0, marginPercent: 40, profitPercent: 20, avgTicket: null, sellers: [] });
  assert.equal(none.ok, false);
  if (!none.ok) assert.match(none.reason, /despesas fixas/);
});
