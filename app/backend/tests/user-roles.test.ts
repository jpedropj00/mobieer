/**
 * Mais de um cargo por usuário: permissões somadas, rótulo, filtro de quem tem
 * uma permissão e a regra de acesso por horário com vários cargos.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_POLICY, accessAllowedAny } from "../src/lib/security-policy";
import { allRoles, cleanExtraRoleIds, effectivePermissions, roleNames, rolesLabel, whereHasPermission } from "../src/lib/user-roles";

const role = (id: string, name: string, label: string, perms: string[]) => ({ id, name, label, permissions: perms.map((code) => ({ permission: { code } })) });
const financeiro = role("r1", "FINANCEIRO", "Financeiro", ["finance.read", "finance.manage", "organization.read"]);
const rh = role("r2", "RH", "Recursos Humanos", ["hr.read", "organization.read", "users.read"]);
const comercial = role("r3", "COMERCIAL", "Comercial", ["commercial.read", "finance.read"]);

test("permissões são a soma de todos os cargos, sem repetição", () => {
  const u = { role: financeiro, extraRoles: [{ role: rh }, { role: comercial }] };
  assert.deepEqual(effectivePermissions(u), ["finance.read", "finance.manage", "organization.read", "hr.read", "users.read", "commercial.read"]);
  assert.deepEqual(roleNames(u), ["FINANCEIRO", "RH", "COMERCIAL"]);
  assert.equal(rolesLabel(u), "Financeiro + Recursos Humanos + Comercial");
});

test("um cargo só continua funcionando igual; adicional repetido do principal não conta duas vezes", () => {
  assert.deepEqual(effectivePermissions({ role: rh }), ["hr.read", "organization.read", "users.read"]);
  assert.equal(rolesLabel({ role: rh }), "Recursos Humanos");
  const dup = { role: rh, extraRoles: [{ role: rh }, { role: financeiro }] };
  assert.deepEqual(allRoles(dup).map((r) => r.id), ["r2", "r1"]);
});

test("cargos adicionais escolhidos: sem o principal, sem repetidos e sem vazios", () => {
  assert.deepEqual(cleanExtraRoleIds("r1", ["r2", "r1", "r2", "", "r3"]), ["r2", "r3"]);
  assert.deepEqual(cleanExtraRoleIds("r1", undefined), []);
  assert.deepEqual(cleanExtraRoleIds("r1", null), []);
});

test("filtro de quem tem uma permissão olha o cargo principal e os adicionais", () => {
  assert.deepEqual(whereHasPermission("hr.read"), {
    OR: [{ role: { permissions: { some: { permission: { code: "hr.read" } } } } }, { extraRoles: { some: { role: { permissions: { some: { permission: { code: "hr.read" } } } } } } }],
  });
  const many = whereHasPermission(["finance.read", "finance.documents.read"]) as { OR: { role?: { permissions: { some: { permission: { code: unknown } } } } }[] };
  assert.deepEqual(many.OR[0].role?.permissions.some.permission.code, { in: ["finance.read", "finance.documents.read"] });
});

test("restrição de horário: com dois cargos, basta um deles estar liberado", () => {
  // segunda-feira 22h em Fortaleza = terça 01h UTC
  const noite = new Date("2026-10-06T01:00:00Z");
  const policy = { ...DEFAULT_POLICY, schedules: [{ role: "FINANCEIRO", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }] };
  assert.equal(accessAllowedAny(policy, { roles: ["FINANCEIRO"], ip: null }, noite).ok, false);
  assert.equal(accessAllowedAny(policy, { roles: ["FINANCEIRO", "RH"], ip: null }, noite).ok, true); // RH não tem restrição
  assert.equal(accessAllowedAny(policy, { roles: ["RH", "FINANCEIRO"], ip: null }, noite).ok, true);
  assert.equal(accessAllowedAny(policy, { roles: ["FINANCEIRO", "ADMIN"], ip: null }, noite).ok, true); // administrador nunca é barrado
  const dia = new Date("2026-10-05T15:00:00Z"); // segunda 12h
  assert.equal(accessAllowedAny(policy, { roles: ["FINANCEIRO"], ip: null }, dia).ok, true);
});
