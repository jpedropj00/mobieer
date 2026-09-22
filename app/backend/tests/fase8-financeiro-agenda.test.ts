/**
 * Fase 8.2: recibo, cadência de lembretes de contas a receber e resposta a
 * convites da agenda.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AgendaResponse, MessageEvent } from "@prisma/client";
import { MISSING, buildReceipt, fmtCalendarDate, receiptNumber, sha256 } from "../src/modules/docgen/docgen.service";
import { milestoneNotifiesClient, receivableMilestone } from "../src/modules/finance/documents.service";
import { assertValidResponse } from "../src/modules/agenda/response.service";
import { AUTOMATION_DEFAULTS } from "../src/lib/automations";
import { templateKeys } from "../src/utils/template";

// ---------------------------------------------------------------------------
// Recibo
// ---------------------------------------------------------------------------

const recibo = {
  number: "REC-ABC12345",
  company: { name: "MOBIEER", document: "12.345.678/0001-90" },
  payer: { name: "Maria Souza", document: "123.456.789-09" },
  amount: 4500,
  paidAt: new Date("2026-09-20T15:00:00Z"),
  method: "PIX",
  reference: "parcela 2/5 Contrato do projeto PRJ-0003",
  projectCode: "PRJ-0003",
  issuedAt: new Date("2026-09-22T15:00:00Z"),
};

test("o recibo diz quem pagou, quanto, por extenso e a que se refere", () => {
  const r = buildReceipt(recibo);
  assert.match(r.body, /Recebemos de Maria Souza/);
  assert.match(r.body, /123\.456\.789-09/);
  assert.match(r.body, /R\$\s?4\.500,00/);
  assert.match(r.body, /quatro mil e quinhentos reais/i);
  assert.match(r.body, /parcela 2\/5/);
  assert.match(r.body, /PIX/);
  assert.match(r.body, /RECIBO Nº REC-ABC12345/);
});

test("o recibo usa a data do pagamento, não a da emissão, no corpo", () => {
  const r = buildReceipt(recibo);
  assert.match(r.body, /Data do pagamento: 20\/09\/2026/);
  assert.match(r.body, /Fortaleza, 22\/09\/2026/);
});

test("pagador sem documento não gera texto quebrado", () => {
  const r = buildReceipt({ ...recibo, payer: { name: "João", document: null } });
  assert.doesNotMatch(r.body, /inscrito\(a\) sob o nº null/);
  assert.match(r.body, /Recebemos de João, a importância/);
});

test("forma de pagamento ausente é dita, não inventada", () => {
  assert.match(buildReceipt({ ...recibo, method: null }).body, /Forma de pagamento: não informada/);
});

test("recibo de valor zero ou negativo é recusado", () => {
  assert.throws(() => buildReceipt({ ...recibo, amount: 0 }));
  assert.throws(() => buildReceipt({ ...recibo, amount: -10 }));
});

test("o número do recibo é estável por pagamento", () => {
  assert.equal(receiptNumber("cmu8trxdj0005tarcvfy9tv3k"), receiptNumber("cmu8trxdj0005tarcvfy9tv3k"));
  assert.match(receiptNumber("cmu8trxdj0005tarcvfy9tv3k"), /^REC-[A-Z0-9]{8}$/);
  assert.notEqual(receiptNumber("pagamento-aaaaaaaa"), receiptNumber("pagamento-bbbbbbbb"));
});

test("o checksum identifica o arquivo exato", () => {
  assert.equal(sha256(Buffer.from("a")), sha256(Buffer.from("a")));
  assert.notEqual(sha256(Buffer.from("a")), sha256(Buffer.from("b")));
  assert.equal(sha256(Buffer.from("")).length, 64);
});

test("data ausente vira o aviso de revisão, nunca uma data inventada", () => {
  assert.equal(fmtCalendarDate(null), MISSING);
  assert.equal(MISSING, "Informação técnica não disponível — revisão necessária.");
});

// ---------------------------------------------------------------------------
// Cadência de contas a receber
// ---------------------------------------------------------------------------

test("7 dias antes é aviso interno; o cliente não recebe nada ainda", () => {
  assert.equal(receivableMilestone(7), "LEMBRETE_7");
  assert.equal(milestoneNotifiesClient("LEMBRETE_7"), false);
});

test("3 dias antes o cliente recebe o lembrete", () => {
  assert.equal(receivableMilestone(3), "LEMBRETE_3");
  assert.equal(milestoneNotifiesClient("LEMBRETE_3"), true);
});

test("no dia do vencimento, aviso de vence hoje", () => {
  assert.equal(receivableMilestone(0), "VENCE_HOJE");
});

test("depois do vencimento, alerta de atraso", () => {
  assert.equal(receivableMilestone(-1), "VENCIDO");
  assert.equal(milestoneNotifiesClient("VENCIDO"), true);
});

test("cada marco tem janela: se o cron falhar um dia, o lembrete sai no seguinte", () => {
  assert.equal(receivableMilestone(6), "LEMBRETE_7", "o de 7 dias ainda sai com 6");
  assert.equal(receivableMilestone(4), "LEMBRETE_7");
  assert.equal(receivableMilestone(2), "LEMBRETE_3", "o de 3 dias ainda sai com 2");
  assert.equal(receivableMilestone(1), "LEMBRETE_3");
  assert.equal(receivableMilestone(-3), "VENCIDO");
});

test("fora das janelas não há lembrete", () => {
  assert.equal(receivableMilestone(8), null, "muito cedo");
  assert.equal(receivableMilestone(30), null);
  assert.equal(receivableMilestone(-6), null, "atraso antigo fica com o alerta diário de vencidos");
});

test("as mensagens de parcela usam só marcadores declarados", () => {
  for (const e of [MessageEvent.PAYMENT_REMINDER, MessageEvent.PAYMENT_DUE_TODAY, MessageEvent.PAYMENT_OVERDUE, MessageEvent.RECEIPT_AVAILABLE]) {
    const def = AUTOMATION_DEFAULTS[e];
    const bad = templateKeys(def.body).filter((k) => !def.vars.includes(k));
    assert.deepEqual(bad, [], `${e}: ${bad.join(", ")}`);
  }
});

test("a mensagem de atraso é lembrete, não cobrança", () => {
  const body = AUTOMATION_DEFAULTS.PAYMENT_OVERDUE.body;
  assert.match(body, /Se já pagou/, "reconhece que pode ser só atraso na baixa");
  assert.doesNotMatch(body, /juros|multa|protesto|cobrança|SPC|Serasa/i);
});

// ---------------------------------------------------------------------------
// Resposta a convite da agenda
// ---------------------------------------------------------------------------

const agora = new Date("2026-09-22T12:00:00Z");
const evento = { status: "SCHEDULED", startAt: new Date("2026-09-25T13:00:00Z"), responsibleId: "resp" };

test("convidado aceita", () => {
  assert.doesNotThrow(() => assertValidResponse(evento, { response: AgendaResponse.ACEITO }, "u1", true, agora));
});

test("quem não foi convidado não responde", () => {
  assert.throws(() => assertValidResponse(evento, { response: AgendaResponse.ACEITO }, "estranho", false, agora), /não foi convidado/);
});

test("o responsável não responde ao próprio compromisso", () => {
  assert.throws(() => assertValidResponse(evento, { response: AgendaResponse.ACEITO }, "resp", true, agora), /responsável/);
});

test("compromisso encerrado não recebe resposta", () => {
  for (const status of ["CANCELLED", "COMPLETED"]) {
    assert.throws(() => assertValidResponse({ ...evento, status }, { response: AgendaResponse.ACEITO }, "u1", true, agora), /encerrado/);
  }
});

test("recusar exige motivo", () => {
  assert.throws(() => assertValidResponse(evento, { response: AgendaResponse.RECUSADO }, "u1", true, agora), /motivo/);
  assert.throws(() => assertValidResponse(evento, { response: AgendaResponse.RECUSADO, note: "  " }, "u1", true, agora), /motivo/);
  assert.doesNotThrow(() => assertValidResponse(evento, { response: AgendaResponse.RECUSADO, note: "Em outra obra" }, "u1", true, agora));
});

test("remarcar exige sugerir um horário futuro", () => {
  assert.throws(() => assertValidResponse(evento, { response: AgendaResponse.REMARCAR }, "u1", true, agora), /novo horário/);
  assert.throws(
    () => assertValidResponse(evento, { response: AgendaResponse.REMARCAR, proposedStart: new Date("2026-09-20T12:00:00Z") }, "u1", true, agora),
    /futuro/
  );
  assert.doesNotThrow(() =>
    assertValidResponse(evento, { response: AgendaResponse.REMARCAR, proposedStart: new Date("2026-09-26T12:00:00Z") }, "u1", true, agora)
  );
});

test("responder 'pendente' não é resposta", () => {
  assert.throws(() => assertValidResponse(evento, { response: AgendaResponse.PENDENTE }, "u1", true, agora), /Escolha/);
});
