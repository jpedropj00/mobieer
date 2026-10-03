/**
 * Confirmação da medição pelo cliente.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { cleanPreferredDates, confirmationState, scheduleChanged } from "../src/modules/measurements/measurements.rules";

const when = new Date("2026-10-20T13:00:00Z");

test("estado da confirmação acompanha o agendamento", () => {
  assert.equal(confirmationState({ status: "REQUESTED", scheduledAt: null }), null);
  assert.equal(confirmationState({ status: "SCHEDULED", scheduledAt: when }), "AWAITING");
  assert.equal(confirmationState({ status: "SCHEDULED", scheduledAt: when, clientConfirmedAt: new Date() }), "CONFIRMED");
  assert.equal(confirmationState({ status: "REQUESTED", scheduledAt: null, rescheduleRequestedAt: new Date() }), "RESCHEDULE_REQUESTED");
  assert.equal(confirmationState({ status: "DONE", scheduledAt: when, clientConfirmedAt: new Date() }), null);
});

test("remarcar derruba a confirmação; salvar sem mexer na data não", () => {
  assert.equal(scheduleChanged(when, undefined), false);
  assert.equal(scheduleChanged(when, new Date(when.getTime())), false);
  assert.equal(scheduleChanged(when, new Date(when.getTime() + 3_600_000)), true);
  assert.equal(scheduleChanged(null, when), true);
  assert.equal(scheduleChanged(when, null), true);
});

test("datas sugeridas: só futuras, sem repetir, no máximo 3 e em ordem", () => {
  assert.deepEqual(cleanPreferredDates(["2026-10-25", "2026-10-01", "2026-10-22", "2026-10-25", "lixo", "2026-10-30", "2026-11-02"], "2026-10-10"), ["2026-10-22", "2026-10-25", "2026-10-30"]);
});
