import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { MessageEvent } from "@prisma/client";
import { AUTOMATION_DEFAULTS, fmtVisit, templateParams } from "../src/lib/automations";
import {
  ASSISTANCE_PROBLEM_TYPES,
  MAX_ASSISTANCE_PHOTOS_ON_OPEN,
  MAX_VISIT_OPTIONS,
  isTomorrowInFortaleza,
  parseClientReply,
  serializeSchedule,
  validateAssistanceRequest,
  validateVisitOptions,
} from "../src/modules/assistance/assistance.service";
import { CHANNELS, canAccessChannel, canDeleteMessage, channelsFor } from "../src/modules/chat/chat.service";
import {
  ROOM_TYPES,
  assertTaskTransition,
  bonusForGain,
  buildProductivityReport,
  capBonus,
  classifyRoom,
  evaluateBonus,
  gainPct,
  logMinutes,
  median,
  normalizeTiers,
  ownTargetMinutes,
  percentile,
} from "../src/modules/contractors/productivity.service";
import { cronAuthorized } from "../src/modules/cron/cron.routes";
import { generateIntegrationToken, hashToken, tokenFromHeaders } from "../src/modules/integrations/integration-token";
import { extractInboundMessages, validMetaSignature } from "../src/modules/integrations/whatsapp-webhook.routes";
import {
  MIN_ORDERS_FOR_ESTIMATE,
  durationStats,
  estimateDeliveryWindow,
  factoryDaysByRoom,
} from "../src/modules/production/leadtime.service";
import { projectCodeFromFileName } from "../src/modules/promob/promob.import";
import {
  PIPELINE_STAGES,
  PIPELINE_STALE_DAYS,
  computeBreakEven,
  deriveProjectStage,
  fortalezaMonthStart,
  fortalezaToday,
  isStale,
  pctChange,
  type ProjectFacts,
} from "../src/modules/store/store.service";
import { InvalidStateError, ValidationError } from "../src/utils/ApiError";
import { templateKeys } from "../src/utils/template";
import { formatCpf, isValidCpf, onlyDigits } from "../src/utils/document";
import { parseInvestment } from "../src/modules/briefing/briefing.service";
import { rateLimit } from "../src/utils/rate-limit";

const DAY = 86400000;
const at = (localIso: string) => new Date(`${localIso}-03:00`);

// ============================ Automações ============================

test("todo texto padrão só usa marcadores declarados para o evento", () => {
  for (const event of Object.values(MessageEvent)) {
    const def = AUTOMATION_DEFAULTS[event];
    assert.ok(def, `evento sem texto padrão: ${event}`);
    const undeclared = templateKeys(def.body).filter((k) => !def.vars.includes(k));
    assert.deepEqual(undeclared, [], `${event} usa marcadores não declarados: ${undeclared.join(", ")}`);
  }
});

test("parâmetros do template da Meta seguem a ordem dos marcadores no texto", () => {
  const body = "Olá {{cliente.nome}}, visita {{assistencia.numero}} em {{assistencia.data}}. {{cliente.nome}}";
  assert.deepEqual(templateParams(body, { "cliente.nome": "Ana", "assistencia.numero": "AST-1", "assistencia.data": "amanhã" }), ["Ana", "AST-1", "amanhã"]);
});

test("data da visita no horário de Fortaleza", () => {
  assert.equal(fmtVisit(at("2026-09-18T09:00:00")), "18/09 (sexta) às 09:00");
  assert.equal(fmtVisit(at("2026-09-18T09:00:00"), "MANHA"), "18/09 (sexta) pela manhã");
  assert.equal(fmtVisit(at("2026-09-21T14:00:00"), "TARDE"), "21/09 (segunda) à tarde");
});

// ============================ Assistência ============================

const now = at("2026-09-16T10:00:00");

test("datas da visita: ordena, recusa passado, repetidas e excesso", () => {
  const ok = validateVisitOptions(
    [
      { startsAt: at("2026-09-19T08:00:00"), period: "MANHA" },
      { startsAt: at("2026-09-18T14:00:00"), period: "TARDE" },
    ],
    now
  );
  assert.equal(ok[0].period, "TARDE");
  assert.throws(() => validateVisitOptions([], now), ValidationError);
  assert.throws(() => validateVisitOptions([{ startsAt: at("2026-09-16T10:30:00") }], now), ValidationError, "menos de 1h");
  assert.throws(() => validateVisitOptions([{ startsAt: at("2026-09-10T10:00:00") }], now), ValidationError, "passado");
  assert.throws(
    () =>
      validateVisitOptions(
        [
          { startsAt: at("2026-09-18T08:00:00"), period: "MANHA" },
          { startsAt: at("2026-09-18T09:30:00"), period: "MANHA" },
        ],
        now
      ),
    ValidationError,
    "mesmo dia e período"
  );
  const many = Array.from({ length: MAX_VISIT_OPTIONS + 1 }, (_, i) => ({ startsAt: new Date(now.getTime() + (i + 1) * DAY) }));
  assert.throws(() => validateVisitOptions(many, now), ValidationError);
});

test("véspera calculada no calendário de Fortaleza, não em UTC", () => {
  // 22h do dia 16 em Fortaleza já é dia 17 em UTC
  const noite = at("2026-09-16T22:00:00");
  assert.equal(isTomorrowInFortaleza(at("2026-09-17T08:00:00"), noite), true);
  assert.equal(isTomorrowInFortaleza(at("2026-09-18T08:00:00"), noite), false);
  assert.equal(isTomorrowInFortaleza(at("2026-09-17T23:30:00"), at("2026-09-16T00:10:00")), true);
});

test("resposta do cliente no WhatsApp", () => {
  for (const t of ["CONFIRMAR", "confirmo", "Sim", "ok, pode vir", "Confirmado!", "\u{1F44D}"]) assert.equal(parseClientReply(t), "CONFIRM", t);
  for (const t of ["REMARCAR", "preciso reagendar", "não vou poder", "nao posso amanha", "quero outra data"]) assert.equal(parseClientReply(t), "RESCHEDULE", t);
  for (const t of ["", "bom dia", "qual o horário?", null]) assert.equal(parseClientReply(t as string), null, String(t));
});

test("estado do agendamento para as telas", () => {
  const base = {
    id: "t",
    number: "AST-1",
    status: "OPEN" as const,
    scheduledAt: null,
    schedulePeriod: null,
    optionsSentAt: null,
    clientConfirmedAt: null,
    reminderSentAt: null,
    rescheduleRequestedAt: null,
    visitOptions: [] as { id: string; startsAt: Date; period: string | null; chosenAt: Date | null }[],
  };
  assert.equal(serializeSchedule(base).stage, "SEM_DATAS");
  const opts = [{ id: "o1", startsAt: at("2026-09-18T08:00:00"), period: "MANHA", chosenAt: null }];
  assert.equal(serializeSchedule({ ...base, visitOptions: opts, optionsSentAt: now }).stage, "AGUARDANDO_CLIENTE");
  assert.equal(serializeSchedule({ ...base, scheduledAt: opts[0].startsAt }).stage, "AGENDADA");
  assert.equal(serializeSchedule({ ...base, scheduledAt: opts[0].startsAt, clientConfirmedAt: now }).stage, "CONFIRMADA");
  assert.equal(serializeSchedule({ ...base, rescheduleRequestedAt: now }).stage, "REMARCAR");
});

// ============================ Webhook e cron ============================

test("assinatura do webhook da Meta", () => {
  const body = Buffer.from('{"entry":[]}');
  const sig = `sha256=${crypto.createHmac("sha256", "segredo").update(body).digest("hex")}`;
  assert.equal(validMetaSignature(body, sig, "segredo"), true);
  assert.equal(validMetaSignature(body, sig, "outro"), false);
  assert.equal(validMetaSignature(body, "sha256=abc", "segredo"), false);
  assert.equal(validMetaSignature(undefined, sig, "segredo"), false);
  assert.equal(validMetaSignature(body, undefined, ""), true, "sem segredo configurado não valida");
});

test("mensagens recebidas: texto, botão e resposta interativa", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                { from: "5585999990000", type: "text", text: { body: "CONFIRMAR" } },
                { from: "5585988880000", type: "button", button: { payload: "REMARCAR", text: "Remarcar" } },
                { from: "5585977770000", type: "interactive", interactive: { button_reply: { id: "CONFIRMAR", title: "Confirmar" } } },
                { from: "5585966660000", type: "image" },
              ],
            },
          },
        ],
      },
    ],
  };
  assert.deepEqual(extractInboundMessages(payload), [
    { from: "5585999990000", text: "CONFIRMAR" },
    { from: "5585988880000", text: "REMARCAR" },
    { from: "5585977770000", text: "CONFIRMAR" },
  ]);
  assert.deepEqual(extractInboundMessages({}), []);
  assert.deepEqual(extractInboundMessages(null), []);
});

test("cron: exige o segredo em produção", () => {
  assert.equal(cronAuthorized("Bearer abc", "abc", true), true);
  assert.equal(cronAuthorized("Bearer abd", "abc", true), false);
  assert.equal(cronAuthorized(undefined, "abc", true), false);
  assert.equal(cronAuthorized(undefined, "", true), false, "produção sem segredo nunca libera");
  assert.equal(cronAuthorized(undefined, "", false), true, "dev sem segredo libera");
});

// ============================ Chat ============================

test("chat: só dois canais — equipe e equipe + montadores", () => {
  const gestor = { id: "g", role: "MANAGER", permissions: ["chat.use", "chat.manage"] };
  const vendedor = { id: "v", role: "REQUESTER", permissions: ["chat.use"] };
  const montador = { id: "m", role: "MONTADOR", permissions: ["chat.use"] };
  assert.deepEqual(Object.keys(CHANNELS), ["TEAM", "CONTRACTORS"]);
  assert.deepEqual(channelsFor(vendedor), ["TEAM", "CONTRACTORS"]);
  assert.deepEqual(channelsFor(montador), ["CONTRACTORS"]);
  assert.equal(canAccessChannel({ kind: "TEAM" }, montador), false, "montador não vê o canal só da equipe");
  assert.equal(canAccessChannel({ kind: "CONTRACTORS" }, montador), true);
  assert.equal(canAccessChannel({ kind: "TEAM" }, vendedor), true);
  assert.equal(canAccessChannel({ kind: "DIRECT" }, gestor), false, "canal que não existe mais");

  const msg = { authorId: "v", createdAt: at("2026-09-16T10:00:00") };
  assert.equal(canDeleteMessage(msg, vendedor, at("2026-09-16T10:10:00")), true);
  assert.equal(canDeleteMessage(msg, vendedor, at("2026-09-16T10:20:00")), false, "passou dos 15 min");
  assert.equal(canDeleteMessage(msg, { id: "x", permissions: ["chat.use"] }, at("2026-09-16T10:01:00")), false);
  assert.equal(canDeleteMessage(msg, gestor, at("2026-09-17T10:00:00")), true, "moderação");
});

// ============================ Produtividade e bônus ============================

test("tipo de cômodo pelo nome do ambiente", () => {
  const cases: [string, string][] = [
    ["Banheiro da Suíte", "BANHEIRO"],
    ["BWC social", "BANHEIRO"],
    ["Lavabo", "LAVABO"],
    ["Cozinha", "COZINHA"],
    ["Dormitório Casal", "DORMITORIO"],
    ["Quarto 2", "DORMITORIO"],
    ["Suíte master", "DORMITORIO"],
    ["Closet", "CLOSET"],
    ["Home Office", "HOME_OFFICE"],
    ["Área de serviço", "LAVANDERIA"],
    ["Espaço gourmet", "AREA_GOURMET"],
    ["Sala de estar", "SALA"],
    ["Varanda", "VARANDA"],
    ["Hall de entrada", "CORREDOR"],
    ["Painel avulso", "OUTRO"],
    ["", "OUTRO"],
  ];
  for (const [name, type] of cases) assert.equal(classifyRoom(name), type, name);
  for (const t of ROOM_TYPES) assert.ok(typeof t === "string");
});

test("mediana e percentil", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(percentile([10, 20, 30, 40, 50], 80), 42);
  assert.equal(percentile([7], 80), 7);
});

test("meta própria: mediana dos últimos cômodos, só com amostra mínima", () => {
  assert.equal(ownTargetMinutes([300, 280], 3), null);
  assert.equal(ownTargetMinutes([300, 280, 320], 3), 300);
  assert.equal(ownTargetMinutes([300, 280, 320, 2000], 3), 310, "um cômodo problemático não distorce");
  // só os 10 mais recentes contam
  assert.equal(ownTargetMinutes([...Array(10).fill(200), ...Array(10).fill(900)], 3), 200);
  assert.equal(ownTargetMinutes([0, -5, 300, 310, 290], 3), 300, "ignora tempos inválidos");
});

test("ganho sobre a meta e faixas de bônus", () => {
  assert.equal(gainPct(300, 240), 20);
  assert.equal(gainPct(300, 330), -10);
  assert.equal(gainPct(0, 100), 0);
  const tiers = normalizeTiers([
    { minGainPct: 20, amount: 60 },
    { minGainPct: 10, amount: 30 },
  ]);
  assert.deepEqual(tiers.map((t) => t.minGainPct), [10, 20]);
  assert.equal(bonusForGain(9.99, tiers), 0);
  assert.equal(bonusForGain(10, tiers), 30);
  assert.equal(bonusForGain(35, tiers), 60);
  assert.throws(() => normalizeTiers([{ minGainPct: 0, amount: 10 }]), InvalidStateError);
  assert.throws(() => normalizeTiers([{ minGainPct: 10, amount: 50 }, { minGainPct: 20, amount: 30 }]), InvalidStateError, "faixa maior pagando menos");
  assert.throws(() => normalizeTiers([{ minGainPct: 10, amount: 50 }, { minGainPct: 10, amount: 60 }]), InvalidStateError);
  assert.equal(capBonus(60, 100, 120), 20);
  assert.equal(capBonus(60, 150, 120), 0);
  assert.equal(capBonus(60, 150, null), 60);
});

test("avaliação do bônus explica o motivo", () => {
  const tiers = [
    { minGainPct: 10, amount: 30 },
    { minGainPct: 20, amount: 60 },
  ];
  const base = { policyEnabled: true, tiers, targetMinutes: 300, actualMinutes: 240, alreadyThisMonth: 0, maxPerMonth: null };
  assert.deepEqual(evaluateBonus(base), { amount: 60, gain: 20, reason: "Superou a própria meta" });
  assert.equal(evaluateBonus({ ...base, policyEnabled: false }).amount, 0);
  assert.match(evaluateBonus({ ...base, targetMinutes: null }).reason, /sem meta/i);
  assert.match(evaluateBonus({ ...base, actualMinutes: 290 }).reason, /abaixo da primeira faixa/);
  assert.match(evaluateBonus({ ...base, actualMinutes: 320 }).reason, /acima da própria meta/);
  assert.deepEqual(evaluateBonus({ ...base, maxPerMonth: 100, alreadyThisMonth: 80 }), { amount: 20, gain: 20, reason: "Bônus limitado pelo teto mensal" });
  assert.equal(evaluateBonus({ ...base, maxPerMonth: 100, alreadyThisMonth: 100 }).amount, 0);
  assert.equal(evaluateBonus({ ...base, actualMinutes: 0 }).amount, 0, "sem tempo registrado não paga");
});

test("cronômetro do cômodo: transições e minutos", () => {
  assert.doesNotThrow(() => assertTaskTransition("PENDING", "start"));
  assert.doesNotThrow(() => assertTaskTransition("PAUSED", "start"));
  assert.doesNotThrow(() => assertTaskTransition("PAUSED", "finish"));
  assert.throws(() => assertTaskTransition("DONE", "start"), InvalidStateError);
  assert.throws(() => assertTaskTransition("PENDING", "pause"), InvalidStateError);
  assert.throws(() => assertTaskTransition("PENDING", "finish"), InvalidStateError, "não conclui sem ter começado");
  assert.equal(logMinutes({ startedAt: at("2026-09-16T08:00:00"), endedAt: at("2026-09-16T10:30:00") }), 150);
  assert.equal(logMinutes({ startedAt: at("2026-09-16T08:00:00"), endedAt: null }, at("2026-09-16T08:45:00")), 45);
});

test("relatório de produtividade por montador e cômodo", () => {
  const r = buildProductivityReport([
    { contractorId: "a", contractorName: "Ana", roomType: "BANHEIRO", workedMinutes: 240, targetMinutes: 300, finishedAt: now, bonusAmount: 60 },
    { contractorId: "a", contractorName: "Ana", roomType: "BANHEIRO", workedMinutes: 300, targetMinutes: 300, finishedAt: now, bonusAmount: 0 },
    { contractorId: "a", contractorName: "Ana", roomType: "COZINHA", workedMinutes: 600, targetMinutes: null, finishedAt: now, bonusAmount: 0 },
    { contractorId: "b", contractorName: "Beto", roomType: "BANHEIRO", workedMinutes: 360, targetMinutes: 330, finishedAt: now, bonusAmount: 0 },
  ]);
  const ana = r.contractors.find((c) => c.contractorId === "a")!;
  assert.equal(ana.rooms, 3);
  assert.equal(ana.hours, 19);
  assert.equal(ana.bonusTotal, 60);
  assert.equal(ana.roomsAboveTarget, 1);
  assert.equal(ana.avgGainPct, 10);
  const banheiro = ana.byRoom.find((x) => x.roomType === "BANHEIRO")!;
  assert.equal(banheiro.medianMinutes, 270);
  assert.equal(banheiro.bestMinutes, 240);
  assert.equal(banheiro.teamMedianMinutes, 300);
  assert.equal(r.team.find((t) => t.roomType === "BANHEIRO")!.count, 3);
  assert.deepEqual(buildProductivityReport([]), { contractors: [], team: [] });
});

// ============================ Prazos ============================

test("estatística de duração e faixa de entrega", () => {
  assert.deepEqual(durationStats([]), { count: 0, median: null, p80: null, min: null, max: null });
  const stats = durationStats([30, 40, 35, 50, 45]);
  assert.equal(stats.median, 40);
  assert.equal(stats.p80, 46);

  const released = at("2026-09-01T09:00:00");
  const w = estimateDeliveryWindow(released, stats, at("2026-09-05T09:00:00"))!;
  assert.equal(w.late, false);
  assert.equal(Math.round((w.from.getTime() - released.getTime()) / DAY), 40);
  assert.equal(Math.round((w.to.getTime() - released.getTime()) / DAY), 46);

  assert.equal(estimateDeliveryWindow(released, durationStats([30, 40]), now), null, `precisa de ${MIN_ORDERS_FOR_ESTIMATE} pedidos`);

  // atrasado: nunca mostra data no passado ao cliente
  const late = estimateDeliveryWindow(released, stats, at("2026-11-01T09:00:00"))!;
  assert.equal(late.late, true);
  assert.ok(late.from > at("2026-11-01T09:00:00") && late.to > late.from);
});

test("dias de fábrica por cômodo ignoram cômodo com peça pendente", () => {
  const d = (s: string) => at(`${s}T08:00:00`);
  const rows = factoryDaysByRoom([
    { orderId: "o1", ambiente: "Banheiro suíte", status: "DONE", startedAt: d("2026-08-01"), completedAt: d("2026-08-03") },
    { orderId: "o1", ambiente: "Banheiro social", status: "DONE", startedAt: d("2026-08-02"), completedAt: d("2026-08-05") },
    { orderId: "o1", ambiente: "Cozinha", status: "DONE", startedAt: d("2026-08-01"), completedAt: d("2026-08-10") },
    { orderId: "o1", ambiente: "Cozinha", status: "IN_PROGRESS", startedAt: d("2026-08-01"), completedAt: null },
    { orderId: "o2", ambiente: "BWC", status: "DONE", startedAt: d("2026-08-01"), completedAt: d("2026-08-02") },
    { orderId: "o2", ambiente: "Painel", status: "CANCELLED", startedAt: null, completedAt: null },
  ]);
  const banheiro = rows.find((r) => r.roomType === "BANHEIRO")!;
  assert.equal(banheiro.count, 2, "um por pedido");
  assert.equal(banheiro.max, 4, "o1: do dia 1 ao dia 5");
  assert.equal(rows.find((r) => r.roomType === "COZINHA"), undefined, "cozinha do o1 ainda tem peça na fábrica");
});

// ============================ Pipeline e ponto de equilíbrio ============================

const facts = (over: Partial<ProjectFacts>): ProjectFacts => ({
  projectStatus: "ACTIVE",
  createdAt: at("2026-08-01T09:00:00"),
  completedAt: null,
  measurement: null,
  techApproval: null,
  production: null,
  pendingPostSale: false,
  ...over,
});

test("etapa do projeto no pipeline da loja", () => {
  const n = at("2026-09-16T09:00:00");
  assert.equal(deriveProjectStage(facts({}), n)!.stage, "MEDICAO");
  assert.equal(
    deriveProjectStage(facts({ measurement: { status: "DONE", createdAt: n, doneAt: at("2026-09-01T09:00:00") } }), n)!.stage,
    "PROJETO_TECNICO"
  );
  assert.equal(deriveProjectStage(facts({ techApproval: { status: "IN_REVIEW", createdAt: n, approvedAt: null } }), n)!.stage, "PROJETO_TECNICO");
  assert.equal(deriveProjectStage(facts({ techApproval: { status: "APPROVED", createdAt: n, approvedAt: n } }), n)!.stage, "PRODUCAO");
  const prod = { stage: "IN_PRODUCTION", releasedAt: at("2026-09-01T09:00:00"), outForDeliveryAt: null, deliveredAt: null };
  assert.equal(deriveProjectStage(facts({ production: prod }), n)!.stage, "PRODUCAO");
  assert.equal(deriveProjectStage(facts({ production: { ...prod, stage: "OUT_FOR_DELIVERY", outForDeliveryAt: n } }), n)!.stage, "ENTREGA_MONTAGEM");

  const delivered = { ...prod, stage: "DELIVERED", deliveredAt: at("2026-09-10T09:00:00") };
  assert.equal(deriveProjectStage(facts({ production: delivered }), n)!.stage, "POS_VENDA");
  const old = { ...prod, stage: "DELIVERED", deliveredAt: at("2026-06-01T09:00:00") };
  assert.equal(deriveProjectStage(facts({ production: old }), n), null, "entregue há muito tempo sai do quadro");
  assert.equal(deriveProjectStage(facts({ production: old, pendingPostSale: true }), n)!.stage, "POS_VENDA", "pós-venda pendente mantém");
  assert.equal(deriveProjectStage(facts({ projectStatus: "CANCELLED" }), n), null);
});

test("alerta de card parado e rótulos completos", () => {
  const n = at("2026-09-16T09:00:00");
  assert.equal(isStale("ASSISTENCIA", at("2026-09-10T09:00:00"), n), true);
  assert.equal(isStale("PRODUCAO", at("2026-09-10T09:00:00"), n), false);
  for (const s of PIPELINE_STAGES) assert.ok(PIPELINE_STALE_DAYS[s] > 0, s);
});

test("ponto de equilíbrio calculado dos lançamentos", () => {
  const r = computeBreakEven({
    months: 2,
    transactions: [
      { type: "RECEITA", category: "Venda de projeto", amount: 200000 },
      { type: "RECEITA", category: "Rendimento de aplicação", amount: 5000 }, // financeira: fora
      { type: "DESPESA", category: "Chapa de MDF", amount: 60000 }, // variável
      { type: "DESPESA", category: "DAS - Simples Nacional", amount: 12000 }, // variável
      { type: "DESPESA", category: "Comissão de vendas", amount: 8000 }, // variável
      { type: "DESPESA", category: "Aluguel", amount: 20000 }, // fixo
      { type: "DESPESA", category: "Salários administrativos", amount: 40000 }, // fixo
      { type: "DESPESA", category: "IRPJ", amount: 3000 }, // fora
    ],
    currentMonthRevenue: 30000,
    averageTicket: 25000,
    dayOfMonth: 15,
    daysInMonth: 30,
  });
  assert.equal(r.averageMonthlyRevenue, 100000);
  assert.equal(r.averageMonthlyVariableCost, 40000);
  assert.equal(r.fixedCostMonthly, 30000);
  assert.equal(r.contributionMarginPct, 60);
  assert.equal(r.breakEvenRevenue, 50000);
  assert.equal(r.progressPct, 60);
  assert.equal(r.projectedMonthRevenue, 60000);
  assert.equal(r.projectedToReach, true);
  assert.equal(r.reached, false);
  assert.equal(r.missingRevenue, 20000);
  assert.equal(r.salesNeededPerMonth, 2);
  assert.equal(r.salesStillNeeded, 1);
  assert.deepEqual(r.source, { fixedCost: "CALCULADO", margin: "CALCULADO" });
});

test("ponto de equilíbrio: valores manuais, margem negativa e sem dados", () => {
  const manual = computeBreakEven({
    months: 1,
    transactions: [],
    currentMonthRevenue: 0,
    averageTicket: null,
    dayOfMonth: 1,
    daysInMonth: 30,
    override: { fixedCostMonthly: 38000, contributionMarginPct: 40 },
  });
  assert.equal(manual.breakEvenRevenue, 95000);
  assert.equal(manual.salesNeededPerMonth, null, "sem ticket médio não chuta quantidade");
  assert.deepEqual(manual.source, { fixedCost: "MANUAL", margin: "MANUAL" });

  const negative = computeBreakEven({
    months: 1,
    transactions: [
      { type: "RECEITA", category: "Venda", amount: 10000 },
      { type: "DESPESA", category: "Chapa de MDF", amount: 12000 },
    ],
    currentMonthRevenue: 0,
    averageTicket: null,
    dayOfMonth: 1,
    daysInMonth: 30,
  });
  assert.equal(negative.breakEvenRevenue, null);
  assert.ok(negative.warnings.some((w) => /negativa/.test(w)));

  const empty = computeBreakEven({ months: 3, transactions: [], currentMonthRevenue: 0, averageTicket: null, dayOfMonth: 1, daysInMonth: 30 });
  assert.equal(empty.breakEvenRevenue, null);
  assert.ok(empty.warnings.length >= 1);
});

test("mês corrente em Fortaleza e variação percentual", () => {
  assert.deepEqual(fortalezaToday(new Date("2026-10-01T02:00:00Z")), { year: 2026, monthIndex: 8, day: 30, daysInMonth: 30 });
  assert.equal(fortalezaMonthStart(2026, 8).toISOString(), "2026-09-01T03:00:00.000Z");
  assert.equal(fortalezaMonthStart(2026, -1).toISOString(), "2025-12-01T03:00:00.000Z", "janeiro - 1 = dezembro do ano anterior");
  assert.equal(pctChange(150, 100), 50);
  assert.equal(pctChange(0, 0), 0);
  assert.equal(pctChange(10, 0), null);
});

// ============================ Promob e tokens ============================

test("projeto pelo nome do arquivo exportado", () => {
  const codes = ["364-1", "364-12", "401-1", "ABC"];
  assert.equal(projectCodeFromFileName("364-1 Cozinha.xml", codes), "364-1");
  assert.equal(projectCodeFromFileName("364-12_orcamento.xml", codes), "364-12");
  assert.equal(projectCodeFromFileName("364-1-rev2.xml", codes), "364-1");
  assert.equal(projectCodeFromFileName("364-123.xml", codes), null, "não casa no meio de outro número");
  assert.equal(projectCodeFromFileName("abc cozinha.pdf", codes), "ABC");
  assert.equal(projectCodeFromFileName("Cozinha 364-1.xml", codes), null);
});

test("token de integração: formato, hash e cabeçalhos", () => {
  const { token, hash, prefix } = generateIntegrationToken();
  assert.match(token, /^mbx_[A-Za-z0-9_-]{43}$/);
  assert.equal(hash, hashToken(token));
  assert.equal(token.startsWith(prefix), true);
  assert.notEqual(generateIntegrationToken().token, token);
  assert.equal(tokenFromHeaders({ "x-mobieer-token": token }), token);
  assert.equal(tokenFromHeaders({ authorization: `Bearer ${token}` }), token);
  assert.equal(tokenFromHeaders({ authorization: "Bearer eyJhbGciOi..." }), null, "JWT de usuário não é token de integração");
  assert.equal(tokenFromHeaders({}), null);
});

// ============================ Cadastro do cliente, briefing e assistência ============================

test("CPF: dígitos verificadores e sequências repetidas", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("52998224725"), true);
  assert.equal(isValidCpf("529.982.247-24"), false, "dígito errado");
  assert.equal(isValidCpf("111.111.111-11"), false, "sequência repetida");
  assert.equal(isValidCpf("123"), false);
  assert.equal(isValidCpf(null), false);
  assert.equal(onlyDigits("529.982.247-25"), "52998224725");
  assert.equal(formatCpf("52998224725"), "529.982.247-25");
});

test("briefing: valor de investimento em texto livre", () => {
  assert.deepEqual(parseInvestment("R$ 45.000,00"), { value: 45000, text: "R$ 45.000,00" });
  assert.deepEqual(parseInvestment("45 mil"), { value: 45000, text: "45 mil" });
  assert.deepEqual(parseInvestment("80000"), { value: 80000, text: "80000" });
  assert.deepEqual(parseInvestment("ainda não sei"), { value: null, text: "ainda não sei" });
  assert.deepEqual(parseInvestment(""), { value: null, text: null });
});

test("pedido de assistência do cliente: exige tipo, ambiente, detalhe e foto", () => {
  const base = {
    problemType: ASSISTANCE_PROBLEM_TYPES[0],
    roomLabel: "Cozinha",
    description: "A porta do armário aéreo ao lado da geladeira está caindo desde ontem",
    photoCount: 2,
    projectId: "p1",
    clientHasProjects: true,
  };
  assert.deepEqual(validateAssistanceRequest(base), {
    title: "Porta desalinhada — Cozinha",
    roomLabel: "Cozinha",
    description: base.description,
  });
  assert.throws(() => validateAssistanceRequest({ ...base, problemType: "Inventado" }), ValidationError);
  assert.throws(() => validateAssistanceRequest({ ...base, roomLabel: " " }), ValidationError);
  assert.throws(() => validateAssistanceRequest({ ...base, description: "porta ruim" }), ValidationError, "descrição curta");
  assert.throws(() => validateAssistanceRequest({ ...base, photoCount: 0 }), ValidationError, "sem foto");
  assert.throws(() => validateAssistanceRequest({ ...base, photoCount: MAX_ASSISTANCE_PHOTOS_ON_OPEN + 1 }), ValidationError);
  assert.throws(() => validateAssistanceRequest({ ...base, projectId: null }), ValidationError, "cliente com projeto precisa escolher");
  assert.doesNotThrow(() => validateAssistanceRequest({ ...base, projectId: null, clientHasProjects: false }));
});

test("limite de tentativas por IP", () => {
  const mw = rateLimit({ name: "t", windowMs: 60_000, max: 2 });
  const req = { headers: { "x-forwarded-for": "10.0.0.1" }, ip: "10.0.0.1" } as never;
  const res = { setHeader: () => undefined } as never;
  const results: unknown[] = [];
  for (let i = 0; i < 3; i++) mw(req, res, (e?: unknown) => results.push(e));
  assert.equal(results[0], undefined);
  assert.equal(results[1], undefined);
  assert.equal((results[2] as { statusCode: number }).statusCode, 429);
  // outro IP não é afetado
  mw({ headers: { "x-forwarded-for": "10.0.0.2" }, ip: "10.0.0.2" } as never, res, (e?: unknown) => results.push(e));
  assert.equal(results[3], undefined);
});
