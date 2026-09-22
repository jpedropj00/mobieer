/**
 * Fase 8.1: timeline central, metas comerciais, rodadas da aprovação técnica
 * e escopo de carteira.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalRoundStatus, StageStatus as S, TimelineStageKey as K } from "@prisma/client";
import {
  SEQUENTIAL_STAGES,
  STAGE_LABEL,
  TIMELINE_STAGES,
  type TimelineFacts,
  applyStagePatch,
  currentStage,
  deriveTimeline,
  diffForHistory,
  isOverdue,
  progressPercent,
  syncPlan,
} from "../src/modules/timeline/timeline.service";
import { conversionRate, goalProgress, monthPace, monthRange, parseMonth } from "../src/modules/commercial/goals.service";
import { isOpenRound, nextRoundNumber, roundStatusFor } from "../src/modules/techproject/rounds.service";
import { clientScope, isContractorOnly, projectScope } from "../src/lib/scope";

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const base: TimelineFacts = { projectCreatedAt: d("2026-01-10"), projectStatus: "ACTIVE" };
const byKey = (stages: { key: K; status: S }[]) => Object.fromEntries(stages.map((s) => [s.key, s]));

// ---------------------------------------------------------------------------
// Estrutura
// ---------------------------------------------------------------------------

test("são 17 etapas, na ordem da especificação, todas com rótulo", () => {
  assert.equal(TIMELINE_STAGES.length, 17);
  assert.deepEqual(TIMELINE_STAGES.slice(0, 5), [K.LEAD, K.BRIEFING, K.ORCAMENTO, K.NEGOCIACAO, K.CONTRATO]);
  assert.deepEqual(TIMELINE_STAGES.slice(-3), [K.VISTORIA, K.GARANTIA, K.ASSISTENCIA]);
  for (const k of TIMELINE_STAGES) assert.ok(STAGE_LABEL[k]?.length > 2, `${k} sem rótulo`);
});

test("garantia e assistência ficam fora da sequência", () => {
  assert.equal(SEQUENTIAL_STAGES.length, 15);
  assert.equal(SEQUENTIAL_STAGES.includes(K.GARANTIA), false);
  assert.equal(SEQUENTIAL_STAGES.includes(K.ASSISTENCIA), false);
});

// ---------------------------------------------------------------------------
// Derivação a partir dos dados reais
// ---------------------------------------------------------------------------

test("projeto novo, sem nada registrado, está no lead", () => {
  const t = byKey(deriveTimeline(base));
  assert.equal(t.LEAD.status, S.EM_ANDAMENTO);
  assert.equal(t.BRIEFING.status, S.PENDENTE);
  assert.equal(t.GARANTIA.status, S.NAO_APLICAVEL);
  assert.equal(t.ASSISTENCIA.status, S.NAO_APLICAVEL);
});

test("briefing e orçamento registrados levam o projeto à negociação", () => {
  const t = byKey(deriveTimeline({ ...base, leadAt: d("2026-01-01"), briefingAt: d("2026-01-03"), quoteAt: d("2026-01-08") }));
  assert.equal(t.LEAD.status, S.CONCLUIDA);
  assert.equal(t.BRIEFING.status, S.CONCLUIDA);
  assert.equal(t.ORCAMENTO.status, S.CONCLUIDA);
  assert.equal(t.NEGOCIACAO.status, S.EM_ANDAMENTO);
});

test("etapa posterior concluída implica as anteriores — sem inventar data", () => {
  // projeto cadastrado direto, já com medição feita: não há lead nem contrato no sistema
  const t = deriveTimeline({ ...base, measurement: { status: "DONE", createdAt: d("2026-02-01"), doneAt: d("2026-02-05") } });
  const m = byKey(t);
  assert.equal(m.CONTRATO.status, S.CONCLUIDA, "quem já foi medido passou pelo contrato");
  const contrato = t.find((s) => s.key === K.CONTRATO)!;
  assert.equal(contrato.completedAt, null, "mas a data do contrato não é inventada");
  assert.equal(contrato.implied, true);
  const medicao = t.find((s) => s.key === K.MEDICAO)!;
  assert.equal(medicao.completedAt?.toISOString().slice(0, 10), "2026-02-05", "a medição tem data real");
  assert.equal(medicao.implied, false);
  assert.equal(m.PROJETO_TECNICO.status, S.EM_ANDAMENTO);
});

test("aprovação técnica e produção avançam a timeline na ordem certa", () => {
  const t = byKey(
    deriveTimeline({
      ...base,
      techApproval: { status: "APPROVED", publishedAt: d("2026-03-01"), approvedAt: d("2026-03-04") },
      production: { stage: "IN_PRODUCTION", releasedAt: d("2026-03-05"), outForDeliveryAt: null, deliveredAt: null },
    })
  );
  assert.equal(t.APROVACAO.status, S.CONCLUIDA);
  assert.equal(t.TERMO_PRODUCAO.status, S.CONCLUIDA, "liberado para a fábrica = termo assinado");
  assert.equal(t.PRODUCAO.status, S.EM_ANDAMENTO);
  assert.equal(t.PRE_MONTAGEM.status, S.PENDENTE);
});

test("projeto técnico enviado mas não aprovado para na aprovação", () => {
  const t = byKey(deriveTimeline({ ...base, techApproval: { status: "IN_REVIEW", publishedAt: d("2026-03-01"), approvedAt: null } }));
  assert.equal(t.PROJETO_TECNICO.status, S.CONCLUIDA);
  assert.equal(t.APROVACAO.status, S.EM_ANDAMENTO);
});

test("montagem só conclui quando todos os cômodos terminaram", () => {
  const entregue = { stage: "DELIVERED", releasedAt: d("2026-03-05"), outForDeliveryAt: d("2026-04-01"), deliveredAt: d("2026-04-02") };
  const parcial = byKey(deriveTimeline({ ...base, production: entregue, installation: { startedAt: d("2026-04-03"), finishedAt: null, allDone: false } }));
  assert.equal(parcial.ENTREGA.status, S.CONCLUIDA);
  assert.equal(parcial.MONTAGEM.status, S.EM_ANDAMENTO);
  const total = byKey(deriveTimeline({ ...base, production: entregue, installation: { startedAt: d("2026-04-03"), finishedAt: d("2026-04-06"), allDone: true } }));
  assert.equal(total.MONTAGEM.status, S.CONCLUIDA);
  assert.equal(total.VISTORIA.status, S.EM_ANDAMENTO);
});

test("garantia só começa depois da vistoria", () => {
  const antes = byKey(deriveTimeline({ ...base, installation: { startedAt: null, finishedAt: null, allDone: true } }));
  assert.equal(antes.GARANTIA.status, S.NAO_APLICAVEL);
  const depois = byKey(deriveTimeline({ ...base, inspectionDoneAt: d("2026-05-01"), warrantyEndsAt: new Date(Date.now() + 365 * 86400000) }));
  assert.equal(depois.VISTORIA.status, S.CONCLUIDA);
  assert.equal(depois.GARANTIA.status, S.EM_ANDAMENTO, "garantia vigente");
});

test("garantia vencida aparece concluída", () => {
  const t = byKey(deriveTimeline({ ...base, inspectionDoneAt: d("2024-01-01"), warrantyEndsAt: d("2025-01-01") }));
  assert.equal(t.GARANTIA.status, S.CONCLUIDA);
});

test("assistência reflete os chamados abertos", () => {
  assert.equal(byKey(deriveTimeline({ ...base, assistance: { open: 1, total: 2, lastOpenedAt: d("2026-06-01") } })).ASSISTENCIA.status, S.EM_ANDAMENTO);
  assert.equal(byKey(deriveTimeline({ ...base, assistance: { open: 0, total: 2, lastOpenedAt: d("2026-06-01") } })).ASSISTENCIA.status, S.CONCLUIDA);
});

test("projeto cancelado não tem etapa em andamento", () => {
  const t = deriveTimeline({ ...base, projectStatus: "CANCELLED", quoteAt: d("2026-01-05") });
  assert.equal(t.some((s) => s.status === S.EM_ANDAMENTO), false);
  assert.equal(byKey(t).NEGOCIACAO.status, S.NAO_APLICAVEL);
});

// ---------------------------------------------------------------------------
// Leitura: atraso, etapa atual e percentual
// ---------------------------------------------------------------------------

const HOJE = d("2026-09-22");

test("etapa com data prevista passada e aberta está atrasada", () => {
  assert.equal(isOverdue({ status: S.EM_ANDAMENTO, plannedAt: d("2026-09-20") }, HOJE), true);
  assert.equal(isOverdue({ status: S.PENDENTE, plannedAt: d("2026-09-21") }, HOJE), true);
});

test("etapa encerrada ou sem data nunca está atrasada", () => {
  assert.equal(isOverdue({ status: S.CONCLUIDA, plannedAt: d("2026-01-01") }, HOJE), false);
  assert.equal(isOverdue({ status: S.NAO_APLICAVEL, plannedAt: d("2026-01-01") }, HOJE), false);
  assert.equal(isOverdue({ status: S.EM_ANDAMENTO, plannedAt: null }, HOJE), false);
});

test("a data prevista de hoje não está atrasada, e é lida como data de calendário", () => {
  assert.equal(isOverdue({ status: S.EM_ANDAMENTO, plannedAt: new Date("2026-09-22T00:00:00Z") }, HOJE), false);
});

test("etapa atual é a primeira sequencial ainda aberta", () => {
  const t = deriveTimeline({ ...base, leadAt: d("2026-01-01"), briefingAt: d("2026-01-02") });
  assert.equal(currentStage(t)?.key, K.ORCAMENTO);
});

test("percentual conta só as etapas da obra, não garantia e assistência", () => {
  const t = deriveTimeline(base);
  assert.equal(progressPercent(t), 0);
  const quase = deriveTimeline({ ...base, inspectionDoneAt: d("2026-05-01") });
  assert.equal(progressPercent(quase), 100, "vistoria feita = obra 100%, com garantia e assistência fora da conta");
});

// ---------------------------------------------------------------------------
// Sincronização: só avança, nunca pisa em decisão humana
// ---------------------------------------------------------------------------

const persisted = (key: K, status: S, manuallyEdited = false) => ({ key, status, startedAt: null, completedAt: null, manuallyEdited });

test("sincronização avança etapa automática", () => {
  const derived = deriveTimeline({ ...base, measurement: { status: "DONE", createdAt: d("2026-02-01"), doneAt: d("2026-02-05") } });
  const plan = syncPlan([persisted(K.MEDICAO, S.EM_ANDAMENTO)], derived);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].status, S.CONCLUIDA);
  assert.equal(plan[0].completedAt?.toISOString().slice(0, 10), "2026-02-05");
});

test("sincronização nunca volta uma etapa", () => {
  const plan = syncPlan([persisted(K.MEDICAO, S.CONCLUIDA)], deriveTimeline(base));
  assert.deepEqual(plan, [], "concluída à mão continua concluída mesmo sem a medição no sistema");
});

test("sincronização não mexe no que uma pessoa editou", () => {
  const derived = deriveTimeline({ ...base, measurement: { status: "DONE", createdAt: d("2026-02-01"), doneAt: d("2026-02-05") } });
  assert.deepEqual(syncPlan([persisted(K.MEDICAO, S.EM_ANDAMENTO, true)], derived), []);
});

test("etapa bloqueada só sai do bloqueio por uma pessoa", () => {
  const derived = deriveTimeline({ ...base, measurement: { status: "DONE", createdAt: d("2026-02-01"), doneAt: d("2026-02-05") } });
  assert.deepEqual(syncPlan([persisted(K.MEDICAO, S.BLOQUEADA)], derived), []);
});

// ---------------------------------------------------------------------------
// Edição manual e histórico
// ---------------------------------------------------------------------------

const agora = new Date("2026-09-22T15:00:00Z");
const aberta = { status: S.EM_ANDAMENTO, startedAt: d("2026-09-01"), completedAt: null };

test("concluir sem data real usa o momento da conclusão", () => {
  const data = applyStagePatch(aberta, { status: S.CONCLUIDA }, agora);
  assert.equal((data.completedAt as Date).toISOString(), agora.toISOString());
});

test("concluir com data real informada respeita a data", () => {
  const data = applyStagePatch(aberta, { status: S.CONCLUIDA, completedAt: d("2026-09-15") }, agora);
  assert.equal((data.completedAt as Date).toISOString().slice(0, 10), "2026-09-15");
});

test("reabrir uma etapa limpa a data de conclusão", () => {
  const data = applyStagePatch({ status: S.CONCLUIDA, startedAt: null, completedAt: d("2026-09-15") }, { status: S.EM_ANDAMENTO }, agora);
  assert.equal(data.completedAt, null);
});

test("data real no futuro é recusada", () => {
  assert.throws(() => applyStagePatch(aberta, { status: S.CONCLUIDA, completedAt: d("2026-12-01") }, agora), /futuro/);
});

test("data real em etapa que não está concluída é recusada", () => {
  assert.throws(() => applyStagePatch(aberta, { status: S.EM_ANDAMENTO, completedAt: d("2026-09-15") }, agora), /concluída/);
});

test("iniciar a etapa marca quando ela começou", () => {
  const data = applyStagePatch({ status: S.PENDENTE, startedAt: null, completedAt: null }, { status: S.EM_ANDAMENTO }, agora);
  assert.equal((data.startedAt as Date).toISOString(), agora.toISOString());
});

test("o histórico registra só o que mudou de fato", () => {
  const diff = diffForHistory({ status: "PENDENTE", notes: "igual", responsibleId: null }, { status: "EM_ANDAMENTO", notes: "igual", responsibleId: "u1" });
  assert.deepEqual(diff.map((c) => c.field).sort(), ["responsibleId", "status"]);
  assert.deepEqual(diff.find((c) => c.field === "status"), { field: "status", fromValue: "PENDENTE", toValue: "EM_ANDAMENTO" });
});

test("datas no histórico são comparadas pelo valor, não pelo objeto", () => {
  assert.deepEqual(diffForHistory({ plannedAt: d("2026-09-01") }, { plannedAt: d("2026-09-01") }), []);
});

// ---------------------------------------------------------------------------
// Metas comerciais
// ---------------------------------------------------------------------------

test("mês inválido é recusado; vazio usa o mês atual de Fortaleza", () => {
  assert.throws(() => parseMonth("2026-13"), /inválido/);
  assert.throws(() => parseMonth("09/2026"), /inválido/);
  assert.equal(parseMonth("2026-09"), "2026-09");
  // 01/10 às 01:00 UTC ainda é 30/09 em Fortaleza
  assert.equal(parseMonth(undefined, new Date("2026-10-01T01:00:00Z")), "2026-09");
});

test("o mês começa à meia-noite de Fortaleza", () => {
  const { from, to } = monthRange("2026-09");
  assert.equal(from.toISOString(), "2026-09-01T03:00:00.000Z");
  assert.equal(to.toISOString(), "2026-10-01T03:00:00.000Z");
});

test("dezembro vira o ano corretamente", () => {
  assert.equal(monthRange("2026-12").to.toISOString(), "2027-01-01T03:00:00.000Z");
});

test("ritmo do mês: dias corridos e restantes", () => {
  const p = monthPace("2026-09", new Date("2026-09-22T12:00:00Z"));
  assert.equal(p.days, 30);
  assert.equal(p.elapsed, 21);
  assert.equal(p.remaining, 9);
});

test("progresso contra a meta: vendido, faltante, percentual e ritmo", () => {
  const g = goalProgress({ goal: 100_000, sold: 40_000, weightedPipeline: 30_000, month: "2026-09", now: new Date("2026-09-22T12:00:00Z") });
  assert.equal(g.missing, 60_000);
  assert.equal(g.percent, 40);
  assert.equal(g.dailyNeeded, Math.round((60_000 / 9) * 100) / 100);
  assert.equal(g.projected, 70_000);
  assert.equal(g.onTrack, false, "previsão abaixo da meta");
});

test("meta batida: faltante zero, sem ritmo a cumprir", () => {
  const g = goalProgress({ goal: 50_000, sold: 60_000, weightedPipeline: 0, month: "2026-09" });
  assert.equal(g.missing, 0);
  assert.equal(g.dailyNeeded, 0);
  assert.equal(g.percent, 120);
  assert.equal(g.onTrack, true);
});

test("sem meta cadastrada não inventa percentual", () => {
  const g = goalProgress({ goal: null, sold: 10_000, weightedPipeline: 5_000, month: "2026-09" });
  assert.equal(g.percent, null);
  assert.equal(g.missing, null);
  assert.equal(g.sold, 10_000, "o vendido aparece mesmo sem meta");
});

test("conversão sem propostas é indefinida, não zero", () => {
  assert.equal(conversionRate(0, 0), null);
  assert.equal(conversionRate(10, 3), 30);
});

// ---------------------------------------------------------------------------
// Rodadas da aprovação técnica
// ---------------------------------------------------------------------------

test("primeira publicação usa o número atual da rodada", () => {
  assert.equal(nextRoundNumber(1, false), 1);
});

test("republicar abre uma rodada nova em vez de reaproveitar a anterior", () => {
  assert.equal(nextRoundNumber(1, true), 2, "depois de ajuste pedido");
  assert.equal(nextRoundNumber(3, true), 4);
});

test("só rodada sem resposta é substituída numa republicação", () => {
  assert.equal(isOpenRound(ApprovalRoundStatus.PUBLICADA), true);
  assert.equal(isOpenRound(ApprovalRoundStatus.APROVADA), false, "aprovada nunca é substituída");
  assert.equal(isOpenRound(ApprovalRoundStatus.MUDANCAS_SOLICITADAS), false, "o pedido de ajuste fica guardado");
});

test("decisão do cliente vira o status final da rodada", () => {
  assert.equal(roundStatusFor("APPROVED"), ApprovalRoundStatus.APROVADA);
  assert.equal(roundStatusFor("CHANGES_REQUESTED"), ApprovalRoundStatus.MUDANCAS_SOLICITADAS);
});

// ---------------------------------------------------------------------------
// Escopo de carteira (acesso horizontal)
// ---------------------------------------------------------------------------

const org = "org-1";
const gestor = { id: "g1", organizationId: org, permissions: ["organization.read", "clients.read.all"] };
const consultor = { id: "c1", organizationId: org, permissions: ["organization.read", "commercial.read"] };
const montador = { id: "m1", organizationId: org, permissions: ["contractors.self", "parts.read"] };

test("quem tem clients.read.all vê todos os clientes da organização, e só dela", () => {
  assert.deepEqual(clientScope(gestor), { organizationId: org });
  assert.deepEqual(projectScope(gestor), { organizationId: org });
});

test("consultor vê só a carteira própria — o que vendeu ou atende", () => {
  assert.deepEqual(clientScope(consultor), { organizationId: org, OR: [{ sellerId: "c1" }, { attendantId: "c1" }] });
});

test("consultor vê os projetos da carteira e os que gerencia", () => {
  const w = projectScope(consultor) as { organizationId: string; OR: unknown[] };
  assert.equal(w.organizationId, org);
  assert.equal(w.OR.length, 3);
  assert.deepEqual(w.OR[2], { managerId: "c1" });
});

test("montador só vê projetos em que tem cômodo atribuído e está ativo", () => {
  assert.equal(isContractorOnly(montador), true);
  assert.deepEqual(projectScope(montador), {
    organizationId: org,
    installationTasks: { some: { contractor: { userId: "m1", active: true } } },
  });
});

test("o escopo nunca deixa de filtrar pela organização", () => {
  for (const u of [gestor, consultor, montador]) {
    assert.equal((clientScope(u) as { organizationId: string }).organizationId, org);
    assert.equal((projectScope(u) as { organizationId: string }).organizationId, org);
  }
});
