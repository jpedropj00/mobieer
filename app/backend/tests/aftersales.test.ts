/**
 * §12/§35/§36/§37 — checklist e resultado da vistoria, prazos e avisos da
 * garantia, calendário de revisões e a timeline vista pelo cliente.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  INSPECTION_CHECKLIST,
  addMonths,
  buildCoverage,
  canComplete,
  checklistRows,
  coverageState,
  maintenanceNeedsReminder,
  maintenanceSchedule,
  parseMaintenanceMonths,
  releasesWarranty,
  warrantyAlertsDue,
} from "../src/modules/aftersales/aftersales.rules";
import { buildInspectionReport, buildWarrantyCertificate } from "../src/modules/aftersales/aftersales.docs";
import { clientTimeline } from "../src/modules/timeline/timeline.portal";
import { STAGE_LABEL } from "../src/modules/timeline/timeline.service";

const d = (s: string) => new Date(`${s}T12:00:00`);

test("checklist segue o papel da Mobieer: 9 seções, 49 itens em ordem", () => {
  assert.equal(INSPECTION_CHECKLIST.length, 9);
  const rows = checklistRows();
  assert.equal(rows.length, 49);
  assert.deepEqual(rows.map((r) => r.position), rows.map((_, i) => i));
  assert.equal(rows[0].label, "Fixação das caixas (mínimo 4 pontos)");
});

const itens = (statuses: (null | "CONFORME" | "NAO_CONFORME" | "NAO_APLICA")[]) =>
  statuses.map((status, i) => ({ section: "Estrutura", label: `Item ${i + 1}`, status }));

test("vistoria: item sem marcação impede concluir e diz qual", () => {
  const r = canComplete(itens(["CONFORME", null]), "APPROVED", null);
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /1 item\(ns\) sem marcação \(Estrutura: Item 2\)/);
});

test("vistoria: não conforme não pode sair 'aprovada sem ressalvas'", () => {
  assert.equal(canComplete(itens(["CONFORME", "NAO_CONFORME"]), "APPROVED", null).ok, false);
  assert.equal(canComplete(itens(["CONFORME", "NAO_CONFORME"]), "APPROVED_WITH_REMARKS", null).ok, false);
  assert.equal(canComplete(itens(["CONFORME", "NAO_CONFORME"]), "APPROVED_WITH_REMARKS", "Tapa-furo cinza").ok, true);
  assert.equal(canComplete(itens(["CONFORME", "NAO_APLICA"]), "APPROVED", null).ok, true);
  assert.equal(canComplete(itens(["NAO_CONFORME"]), "REJECTED", "").ok, false);
});

test("só vistoria aprovada libera garantia", () => {
  assert.equal(releasesWarranty("APPROVED"), true);
  assert.equal(releasesWarranty("APPROVED_WITH_REMARKS"), true);
  assert.equal(releasesWarranty("REJECTED"), false);
});

test("meses somados respeitam o fim do mês", () => {
  assert.equal(addMonths(d("2026-01-31"), 1).getDate(), 28);
  assert.equal(addMonths(d("2028-01-31"), 1).getDate(), 29);
  assert.equal(addMonths(d("2026-07-27"), 12).getFullYear(), 2027);
});

test("garantia por componente: 5, 5, 2 e 1 ano; fim geral é o maior", () => {
  const { coverage, endsAt } = buildCoverage(d("2026-07-27"));
  assert.deepEqual(coverage.map((c) => [c.key, c.months]), [["estrutura", 60], ["ferragens", 60], ["puxadores", 24], ["aramados", 12]]);
  assert.equal(endsAt.getFullYear(), 2031);
  assert.equal(new Date(coverage[3].endsAt).getFullYear(), 2027);
});

test("aviso de fim: 30 dias antes, uma vez por componente", () => {
  const { coverage } = buildCoverage(d("2025-10-20"));
  const now = d("2026-09-25"); // aramados vencem em 20/10/2026: faltam 25 dias
  const due = warrantyAlertsDue(coverage, [], now);
  assert.deepEqual(due.map((x) => x.key), ["aramados:30d"]);
  assert.equal(warrantyAlertsDue(coverage, ["aramados:30d"], now).length, 0);
  assert.equal(coverageState(coverage[3], now).state, "EXPIRING");
  assert.equal(coverageState(coverage[0], now).state, "ACTIVE");
  assert.equal(coverageState(coverage[3], d("2026-11-01")).state, "EXPIRED");
});

test("revisões: configuração e lembrete a 7 dias, uma vez", () => {
  assert.deepEqual(parseMaintenanceMonths(null), [6, 12]);
  assert.deepEqual(parseMaintenanceMonths("[12, 6, 6, 0, 200]"), [6, 12]);
  assert.deepEqual(parseMaintenanceMonths("[]"), []);
  assert.deepEqual(parseMaintenanceMonths("quebrado"), [6, 12]);
  const s = maintenanceSchedule(d("2026-01-10"), [6]);
  assert.equal(s[0].label, "Revisão preventiva de 6 meses");
  const now = d("2026-07-05");
  assert.equal(maintenanceNeedsReminder({ status: "SCHEDULED", dueAt: s[0].dueAt, remindedAt: null }, now), true);
  assert.equal(maintenanceNeedsReminder({ status: "SCHEDULED", dueAt: s[0].dueAt, remindedAt: now }, now), false);
  assert.equal(maintenanceNeedsReminder({ status: "SCHEDULED", dueAt: d("2026-08-01"), remindedAt: null }, now), false);
  assert.equal(maintenanceNeedsReminder({ status: "DONE", dueAt: s[0].dueAt, remindedAt: null }, now), false);
});

test("relatório e certificado não inventam dado ausente", () => {
  const rep = buildInspectionReport({
    company: "Mobieer",
    client: { name: "Juliana", document: null, address: null },
    project: { code: "364-1", name: "Apto" },
    inspectedAt: d("2026-07-27"),
    ambientes: null,
    technician: "Jessica",
    installers: null,
    items: [{ section: "Estrutura", label: "Rodapé", status: "NAO_CONFORME", note: "riscado" }],
    result: "APPROVED_WITH_REMARKS",
    pendencias: "Tapa-furo cinza",
    notes: null,
    clientSignerName: "Juliana",
    signedByClient: true,
    signedByTechnician: false,
    photoCount: 3,
    issuedAt: d("2026-07-27"),
  });
  assert.match(rep.body, /\[NC\] Rodapé — riscado/);
  assert.match(rep.body, /Endereço: não informado/);
  assert.match(rep.body, /Entrega aprovada com ressalvas/);
  assert.match(rep.body, /Técnico responsável: Jessica — sem assinatura registrada/);

  const cert = buildWarrantyCertificate({
    company: "Mobieer",
    client: { name: "Juliana", document: "123", phone: null, email: null, address: null, city: null, zipCode: null },
    project: { code: "364-1", name: "Apto" },
    designer: null,
    consultant: null,
    installers: null,
    purchaseDate: null,
    deliveryDate: null,
    inspectionDate: d("2026-07-27"),
    ambientes: "Cozinha",
    coverage: buildCoverage(d("2026-07-27")).coverage,
    issuedAt: d("2026-07-27"),
  });
  assert.match(cert.body, /Aramados \(porta-objetos, porta-pano, cabideiros etc\.\): 1 ano/);
  assert.match(cert.body, /Estrutura e montagem: 5 anos/);
  assert.match(cert.body, /Projetista: não informado/);
  assert.doesNotMatch(cert.body, /revisão necessária/);
});

test("timeline do cliente: só o fluxo da especificação e sem 'bloqueada'", () => {
  const stages = [
    { key: "LEAD" as const, status: "CONCLUIDA" as const },
    { key: "BRIEFING" as const, status: "CONCLUIDA" as const },
    { key: "ORCAMENTO" as const, status: "CONCLUIDA" as const },
    { key: "CONTRATO" as const, status: "CONCLUIDA" as const },
    { key: "PAGAMENTO_ENTRADA" as const, status: "CONCLUIDA" as const },
    { key: "MEDICAO" as const, status: "BLOQUEADA" as const },
    { key: "ASSISTENCIA" as const, status: "NAO_APLICAVEL" as const },
  ].map((s) => ({ ...s, plannedAt: null, startedAt: null, completedAt: null }));
  const t = clientTimeline(stages, STAGE_LABEL);
  assert.equal(t.stages.length, 13);
  assert.ok(!t.stages.some((s) => s.key === "LEAD" || s.key === "NEGOCIACAO" || s.key === "TERMO_PRODUCAO"));
  assert.equal(t.stages.find((s) => s.key === "MEDICAO")!.status, "CURRENT");
  assert.equal(t.current, "Medição");
  assert.equal(t.stages.find((s) => s.key === "PAGAMENTO_ENTRADA")!.label, "Pagamento");
  // 4 concluídas de 11 etapas da obra (garantia e assistência ficam fora)
  assert.equal(t.progress, 36);
});

test("timeline do cliente: sem etapa em andamento, a próxima pendente vira a atual", () => {
  const t = clientTimeline(
    [{ key: "BRIEFING" as const, status: "CONCLUIDA" as const, plannedAt: null, startedAt: null, completedAt: null }],
    STAGE_LABEL
  );
  assert.equal(t.current, "Orçamento");
});
