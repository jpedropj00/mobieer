/**
 * Política de segurança: senha, validade, IP e horário de acesso.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_POLICY, accessAllowed, ipMatches, localClock, normalizePolicy, passwordExpired, passwordProblems, validIpRule } from "../src/lib/security-policy";

test("senha: tamanho, maiúscula, minúscula, número; símbolo só se exigido", () => {
  assert.deepEqual(passwordProblems("Mobieer2026", DEFAULT_POLICY), []);
  assert.deepEqual(passwordProblems("abc", DEFAULT_POLICY), ["ter pelo menos 8 caracteres", "ter uma letra maiúscula", "ter um número"]);
  assert.deepEqual(passwordProblems("Mobieer2026", { ...DEFAULT_POLICY, requireSymbol: true }), ["ter um símbolo (ex.: ! @ # $)"]);
});

test("senha não pode conter o nome/e-mail nem ser óbvia", () => {
  assert.ok(passwordProblems("Juliana2026", DEFAULT_POLICY, { name: "Juliana Castro" }).includes("não conter o seu nome ou e-mail"));
  assert.ok(passwordProblems("Admin12345", DEFAULT_POLICY, { email: "admin@mobieer.com.br" }).length > 0);
  assert.ok(passwordProblems("mudar123", { ...DEFAULT_POLICY, requireUpper: false, requireDigit: false }).includes("não ser uma senha óbvia"));
});

test("validade: desligada com 0 dias; sem data de troca conta como vencida", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  assert.equal(passwordExpired(null, DEFAULT_POLICY, now), false);
  const p = { ...DEFAULT_POLICY, expiryDays: 90 };
  assert.equal(passwordExpired(null, p, now), true);
  assert.equal(passwordExpired(new Date("2026-08-01T12:00:00Z"), p, now), false);
  assert.equal(passwordExpired(new Date("2026-06-01T12:00:00Z"), p, now), true);
});

test("IP: exato, IPv4 mapeado em IPv6 e faixa CIDR", () => {
  assert.equal(ipMatches("::ffff:189.1.2.3", "189.1.2.3"), true);
  assert.equal(ipMatches("189.1.2.200", "189.1.2.0/24"), true);
  assert.equal(ipMatches("189.1.3.1", "189.1.2.0/24"), false);
  assert.equal(ipMatches("10.0.0.1", "0.0.0.0/0"), true);
  assert.equal(validIpRule("189.1.2.0/24"), true);
  assert.equal(validIpRule("189.1.2.0/40"), false);
  assert.equal(validIpRule("loja"), false);
});

test("acesso por IP: admin e perfis isentos passam; lista vazia libera todos", () => {
  const p = normalizePolicy({ allowedIps: ["189.1.2.0/24"], ipExemptRoles: ["MONTADOR"] });
  assert.equal(accessAllowed(p, { role: "COMERCIAL", ip: "189.1.2.9" }).ok, true);
  assert.equal(accessAllowed(p, { role: "COMERCIAL", ip: "200.0.0.1" }).ok, false);
  assert.equal(accessAllowed(p, { role: "ADMIN", ip: "200.0.0.1" }).ok, true);
  assert.equal(accessAllowed(p, { role: "MONTADOR", ip: "200.0.0.1" }).ok, true);
  assert.equal(accessAllowed(DEFAULT_POLICY, { role: "COMERCIAL", ip: "200.0.0.1" }).ok, true);
});

test("acesso por horário no fuso da loja, inclusive janela que vira a meia-noite", () => {
  // 2026-09-28 é segunda; 12:00Z = 09:00 em Fortaleza
  const seg9h = new Date("2026-09-28T12:00:00Z");
  assert.deepEqual(localClock(seg9h), { day: 1, minutes: 540 });
  const p = normalizePolicy({ schedules: [{ role: "COMERCIAL", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }, { role: "VIGIA", days: [1], start: "22:00", end: "06:00" }] });
  assert.equal(accessAllowed(p, { role: "COMERCIAL", ip: null }, seg9h).ok, true);
  const r = accessAllowed(p, { role: "COMERCIAL", ip: null }, new Date("2026-09-28T23:00:00Z")); // 20h
  assert.equal(r.ok, false);
  assert.equal(accessAllowed(p, { role: "COMERCIAL", ip: null }, new Date("2026-09-27T12:00:00Z")).ok, false); // domingo
  assert.equal(accessAllowed(p, { role: "VIGIA", ip: null }, new Date("2026-09-29T02:00:00Z")).ok, true); // seg 23h
  assert.equal(accessAllowed(p, { role: "FINANCEIRO", ip: null }, new Date("2026-09-27T12:00:00Z")).ok, true); // sem janela
});

test("configuração gravada torta é normalizada", () => {
  const p = normalizePolicy({ minLength: 2, maxAttempts: 999, expiryDays: -3, allowedIps: [" 1.2.3.4 ", ""] });
  assert.equal(p.minLength, 6);
  assert.equal(p.maxAttempts, 20);
  assert.equal(p.expiryDays, 0);
  assert.deepEqual(p.allowedIps, ["1.2.3.4"]);
});
