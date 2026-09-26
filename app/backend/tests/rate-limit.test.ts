/**
 * Limite de tentativas (§61). O relógio entra por parâmetro, então os testes
 * não dependem de espera real.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { LIMITS, clientKey, hitLimit, purgeExpired, type RateStore } from "../src/utils/rate-limit";

const opts = { windowMs: 60_000, max: 3 };
const novaStore = (): RateStore => new Map();

test("as primeiras tentativas passam e o restante é contado", () => {
  const s = novaStore();
  assert.deepEqual(
    [1, 2, 3].map(() => hitLimit(s, "ip", opts, 1000).remaining),
    [2, 1, 0]
  );
});

test("a tentativa além do limite é barrada", () => {
  const s = novaStore();
  for (let i = 0; i < opts.max; i++) assert.equal(hitLimit(s, "ip", opts, 1000).allowed, true);
  assert.equal(hitLimit(s, "ip", opts, 1000).allowed, false);
});

test("o Retry-After diz quanto falta da janela, arredondando para cima", () => {
  const s = novaStore();
  for (let i = 0; i < opts.max; i++) hitLimit(s, "ip", opts, 0);
  // 59,8s depois ainda falta 200ms: precisa dizer 1s, nunca 0
  const r = hitLimit(s, "ip", opts, 59_800);
  assert.equal(r.allowed, false);
  assert.equal(r.retryAfterSec, 1);
});

test("passada a janela, volta a contar do zero", () => {
  const s = novaStore();
  for (let i = 0; i < opts.max; i++) hitLimit(s, "ip", opts, 0);
  assert.equal(hitLimit(s, "ip", opts, 0).allowed, false);
  assert.equal(hitLimit(s, "ip", opts, 60_000).allowed, true, "na virada já libera");
  assert.equal(hitLimit(s, "ip", opts, 60_000).remaining, 1, "e é uma janela nova, não a antiga");
});

test("um IP bloqueado não bloqueia os outros", () => {
  const s = novaStore();
  for (let i = 0; i < opts.max + 1; i++) hitLimit(s, "ip-a", opts, 1000);
  assert.equal(hitLimit(s, "ip-a", opts, 1000).allowed, false);
  assert.equal(hitLimit(s, "ip-b", opts, 1000).allowed, true);
});

test("cada grupo de rota tem a sua cota", () => {
  assert.notEqual(clientKey({ ip: "1.2.3.4" }, "auth"), clientKey({ ip: "1.2.3.4" }, "upload"));
});

test("sem IP, ainda cai numa chave — não quebra", () => {
  assert.equal(clientKey({ ip: undefined as unknown as string }, "auth"), "auth:desconhecido");
  assert.equal(clientKey({ ip: undefined as unknown as string, socket: { remoteAddress: "9.9.9.9" } }, "auth"), "auth:9.9.9.9");
});

test("a limpeza tira só as janelas vencidas", () => {
  const s = novaStore();
  hitLimit(s, "velho", opts, 0);
  hitLimit(s, "novo", opts, 50_000);
  assert.equal(purgeExpired(s, 60_001), 1);
  assert.deepEqual([...s.keys()], ["novo"]);
});

test("a memória não cresce sem limite: quem venceu sai", () => {
  const s = novaStore();
  for (let i = 0; i < 500; i++) hitLimit(s, `ip-${i}`, opts, 0);
  assert.equal(s.size, 500);
  purgeExpired(s, 60_001);
  assert.equal(s.size, 0);
});

test("os limites configurados são estritos onde precisa", () => {
  // Login é o alvo de força bruta: janela longa e poucas tentativas.
  assert.equal(LIMITS.auth.max <= 20, true);
  assert.equal(LIMITS.auth.windowMs >= 10 * 60_000, true);
  // Upload é mais permissivo: protege banda, não credencial.
  assert.equal(LIMITS.upload.max > LIMITS.auth.max, true);
});
