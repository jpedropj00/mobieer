/**
 * Fase 8.3: localização no ponto (LGPD), banco de horas do montador, medidas
 * por ambiente e avaliação da montagem.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptLocation,
  distanceMeters,
  fmtMinutes,
  hourBank,
  measureChanged,
  performanceSummary,
  ratingAverage,
  validateRating,
  validateRoomMeasure,
} from "../src/modules/fieldwork/fieldwork.service";

// ---------------------------------------------------------------------------
// Localização
// ---------------------------------------------------------------------------

test("sem consentimento, nenhuma coordenada é gravada — mesmo se o aparelho mandar", () => {
  assert.deepEqual(acceptLocation({ consent: false, lat: -3.73, lng: -38.52 }), { consent: false, fix: null });
  assert.deepEqual(acceptLocation({ lat: -3.73, lng: -38.52 }), { consent: false, fix: null }, "ausência de consentimento é recusa");
});

test("com consentimento, grava a posição arredondada", () => {
  const r = acceptLocation({ consent: true, lat: -3.731861234567, lng: -38.526669876543, accuracy: 12.7 });
  assert.equal(r.consent, true);
  assert.deepEqual(r.fix, { lat: -3.731861, lng: -38.52667, accuracy: 13 });
});

test("consentiu mas o aparelho não achou a posição: o ponto vale sem coordenada", () => {
  assert.deepEqual(acceptLocation({ consent: true }), { consent: true, fix: null });
});

test("coordenada impossível é recusada", () => {
  assert.throws(() => acceptLocation({ consent: true, lat: 91, lng: 0 }), /Latitude/);
  assert.throws(() => acceptLocation({ consent: true, lat: 0, lng: 181 }), /Longitude/);
  assert.throws(() => acceptLocation({ consent: true, lat: 0, lng: 0 }), /0,0/, "0,0 é o valor que o GPS devolve quando falha");
  assert.throws(() => acceptLocation({ consent: true, lat: NaN, lng: 1 }), /Latitude/);
});

test("precisão inválida vira nula, não quebra o ponto", () => {
  assert.equal(acceptLocation({ consent: true, lat: -3.7, lng: -38.5, accuracy: -5 }).fix?.accuracy, null);
});

test("distância entre entrada e saída", () => {
  // Praça do Ferreira → Dragão do Mar, em Fortaleza: ~1 km
  const d = distanceMeters({ lat: -3.72771, lng: -38.52698 }, { lat: -3.72229, lng: -38.51975 });
  assert.ok(d > 900 && d < 1100, `${d} m`);
  assert.equal(distanceMeters({ lat: -3.7, lng: -38.5 }, { lat: -3.7, lng: -38.5 }), 0);
});

// ---------------------------------------------------------------------------
// Banco de horas
// ---------------------------------------------------------------------------

// 12:00 UTC = 09:00 em Fortaleza
const turno = (dia: string, hIni: number, hFim: number) => ({
  checkInAt: new Date(`${dia}T${String(hIni + 3).padStart(2, "0")}:00:00Z`),
  checkOutAt: new Date(`${dia}T${String(hFim + 3).padStart(2, "0")}:00:00Z`),
});

test("dia de 9h com jornada de 8h: 1h extra e saldo positivo", () => {
  const b = hourBank([turno("2026-09-21", 8, 17)], 480);
  assert.equal(b.days[0].workedMinutes, 540);
  assert.equal(b.days[0].extraMinutes, 60);
  assert.equal(b.days[0].balanceMinutes, 60);
});

test("dia curto deixa saldo negativo e nenhuma hora extra", () => {
  const b = hourBank([turno("2026-09-21", 8, 12)], 480);
  assert.equal(b.days[0].extraMinutes, 0);
  assert.equal(b.days[0].balanceMinutes, -240);
});

test("dois turnos no mesmo dia somam num dia só", () => {
  const b = hourBank([turno("2026-09-21", 8, 12), turno("2026-09-21", 13, 18)], 480);
  assert.equal(b.days.length, 1);
  assert.equal(b.days[0].shifts, 2);
  assert.equal(b.days[0].workedMinutes, 540);
});

test("a jornada prevista conta só nos dias trabalhados", () => {
  const b = hourBank([turno("2026-09-21", 8, 16), turno("2026-09-23", 8, 16)], 480);
  assert.equal(b.totals.daysWorked, 2);
  assert.equal(b.totals.expectedMinutes, 960, "o dia 22 sem trabalho não conta como falta");
  assert.equal(b.totals.balanceMinutes, 0);
});

test("ponto em aberto não entra na conta, mas é informado", () => {
  const b = hourBank([turno("2026-09-21", 8, 17), { checkInAt: new Date("2026-09-22T11:00:00Z"), checkOutAt: null }], 480);
  assert.equal(b.totals.daysWorked, 1);
  assert.equal(b.openShifts, 1);
});

test("o dia é o de Fortaleza, não o UTC", () => {
  // 21/09 22:00 em Fortaleza = 22/09 01:00 UTC
  const b = hourBank([{ checkInAt: new Date("2026-09-22T01:00:00Z"), checkOutAt: new Date("2026-09-22T02:00:00Z") }], 480);
  assert.equal(b.days[0].day, "2026-09-21");
});

test("jornada prevista absurda é recusada", () => {
  assert.throws(() => hourBank([], 0));
  assert.throws(() => hourBank([], 25 * 60));
});

test("minutos formatados para leitura", () => {
  assert.equal(fmtMinutes(450), "7h30");
  assert.equal(fmtMinutes(-65), "-1h05");
  assert.equal(fmtMinutes(0), "0h");
  assert.equal(fmtMinutes(120), "2h");
});

// ---------------------------------------------------------------------------
// Medidas por ambiente
// ---------------------------------------------------------------------------

test("medida válida passa; nenhuma dimensão é obrigatória", () => {
  assert.doesNotThrow(() => validateRoomMeasure({ name: "Cozinha", widthMm: 3200, heightMm: 2600, depthMm: 600, ceilingHeightMm: 2700 }));
  assert.doesNotThrow(() => validateRoomMeasure({ name: "Cozinha" }));
});

test("ambiente sem nome é recusado", () => {
  assert.throws(() => validateRoomMeasure({ name: "  " }), /ambiente/);
});

test("medida em metros no campo de milímetro é barrada", () => {
  assert.throws(() => validateRoomMeasure({ name: "Sala", widthMm: 32000 }), /milímetros/);
  assert.throws(() => validateRoomMeasure({ name: "Sala", widthMm: 0 }), /maior que zero/);
});

test("altura acima do pé-direito é incoerente", () => {
  assert.throws(() => validateRoomMeasure({ name: "Quarto", heightMm: 2900, ceilingHeightMm: 2700 }), /pé-direito/);
});

test("mudança real gera versão; reenviar o mesmo valor não", () => {
  const antes = { name: "Cozinha", widthMm: 3200, heightMm: null, notes: "" };
  assert.deepEqual(measureChanged(antes, { name: "Cozinha", widthMm: 3200 }), []);
  assert.deepEqual(measureChanged(antes, { widthMm: 3150 }), ["widthMm"]);
  assert.deepEqual(measureChanged(antes, { notes: null }), [], "vazio e nulo são a mesma coisa");
  assert.deepEqual(measureChanged(antes, { interferences: "Viga a 2,40 m" }), ["interferences"]);
});

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------

const boa = { quality: 5, deadline: 4, organizationScore: 5, finish: 5, service: 4, rework: false };

test("notas de 1 a 5 em cada critério", () => {
  assert.doesNotThrow(() => validateRating(boa));
  assert.throws(() => validateRating({ ...boa, quality: 0 }), /Qualidade/);
  assert.throws(() => validateRating({ ...boa, deadline: 6 }), /Prazo/);
  assert.throws(() => validateRating({ ...boa, finish: 4.5 }), /Acabamento/);
});

test("retrabalho exige descrição", () => {
  assert.throws(() => validateRating({ ...boa, rework: true }), /retrabalho/);
  assert.doesNotThrow(() => validateRating({ ...boa, rework: true, reworkNotes: "Porta refeita" }));
});

test("média das cinco notas", () => {
  assert.equal(ratingAverage(boa), 4.6);
});

test("histórico de desempenho: médias e taxa de retrabalho", () => {
  const s = performanceSummary([boa, { ...boa, quality: 3, rework: true, reworkNotes: "x" }]);
  assert.equal(s.count, 2);
  assert.equal(s.byCriterion?.quality, 4);
  assert.equal(s.reworkRate, 50);
  assert.ok((s.average ?? 0) > 4 && (s.average ?? 0) < 4.6);
});

test("sem avaliações, o desempenho é indefinido, não zero", () => {
  assert.deepEqual(performanceSummary([]), { count: 0, average: null, byCriterion: null, reworkRate: null });
});
