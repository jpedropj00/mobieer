/**
 * Monitoramento: agrupamento do erro por rota e limite de avisos.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ALERT_WINDOW_MS, MAX_ALERTS_PER_HOUR, clientAlertText, newAlertStore, routeKey, serverAlertText, shouldAlert } from "../src/lib/monitoring.rules";

test("a chave do erro troca ids por :id e ignora a query", () => {
  assert.equal(routeKey("get", "/api/business/projects/cmtp5oybn002ptaf0zouepwyh?x=1"), "GET /api/business/projects/:id");
  assert.equal(routeKey("POST", "/api/production/projects/8d3f2a10-1b2c-4d5e-9f00-aabbccddeeff/renders"), "POST /api/production/projects/:id/renders");
  assert.equal(routeKey("PATCH", "/api/finance/transactions/42"), "PATCH /api/finance/transactions/:id");
  assert.equal(routeKey("GET", "/api/finance/dre"), "GET /api/finance/dre");
});

test("um aviso por erro a cada 15 minutos e teto por hora", () => {
  const s = newAlertStore();
  const t0 = 1_000_000;
  assert.equal(shouldAlert(s, "GET /a", t0), true);
  assert.equal(shouldAlert(s, "GET /a", t0 + 60_000), false); // mesmo erro, logo depois
  assert.equal(shouldAlert(s, "GET /b", t0 + 60_000), true); // erro diferente passa
  assert.equal(shouldAlert(s, "GET /a", t0 + ALERT_WINDOW_MS + 1), true); // passou a janela
  const many = newAlertStore();
  let sent = 0;
  for (let i = 0; i < 30; i++) if (shouldAlert(many, `GET /x${i}`, t0 + i)) sent++;
  assert.equal(sent, MAX_ALERTS_PER_HOUR);
  assert.equal(shouldAlert(many, "GET /novo", t0 + 61 * 60_000), true); // na hora seguinte volta a avisar
});

test("texto do aviso: rota, código de rastreio e, na tela, sem o token do link", () => {
  const a = serverAlertText({ key: "GET /api/finance/dre", errorId: "ab12cd", code: "INTERNAL_ERROR" });
  assert.equal(a.title, "Erro no sistema");
  assert.match(a.message, /GET \/api\/finance\/dre falhou — código ab12cd/);
  assert.match(serverAlertText({ key: "POST /api/x", code: "DATABASE_UNAVAILABLE" }).message, /\(DATABASE_UNAVAILABLE\)/);
  const c = clientAlertText({ message: "Cannot read properties of undefined (reading 'map')", path: "/os/segredo-do-montador-123?x=1" });
  assert.equal(c.title, "Erro em uma tela");
  assert.match(c.message, /^Em \/os\/:token: Cannot read properties/);
  assert.doesNotMatch(c.message + c.key, /segredo/);
});
