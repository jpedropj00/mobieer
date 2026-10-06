/**
 * Mais de um cargo por usuário. O cargo principal continua em `User.roleId`
 * (é o que aparece primeiro e o que as regras antigas usam); os adicionais
 * ficam em `UserExtraRole`. As permissões da pessoa são a soma de todos.
 */
import type { Prisma } from "@prisma/client";

type RoleWithPerms = { id: string; name: string; label: string; permissions: { permission: { code: string } }[] };
export type UserWithRoles = { role: RoleWithPerms; extraRoles?: { role: RoleWithPerms }[] };

/** Para usar em `include` ao carregar o usuário com tudo o que define o acesso. */
export const rolesInclude = {
  role: { include: { permissions: { include: { permission: true } } } },
  extraRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
} satisfies Prisma.UserInclude;

/** Principal primeiro, depois os adicionais, sem repetir. */
export function allRoles(user: UserWithRoles): RoleWithPerms[] {
  const out = [user.role];
  for (const e of user.extraRoles ?? []) if (!out.some((r) => r.id === e.role.id)) out.push(e.role);
  return out;
}

export const roleNames = (user: UserWithRoles) => allRoles(user).map((r) => r.name);
export const roleLabels = (user: UserWithRoles) => allRoles(user).map((r) => r.label);

/** Soma das permissões de todos os cargos, sem repetição. */
export function effectivePermissions(user: UserWithRoles): string[] {
  return [...new Set(allRoles(user).flatMap((r) => r.permissions.map((p) => p.permission.code)))];
}

/** Rótulo para exibição: "Financeiro + Recursos Humanos". */
export const rolesLabel = (user: UserWithRoles) => roleLabels(user).join(" + ");

/**
 * Filtro "usuários que têm esta permissão", por qualquer um dos cargos.
 * Aceita um código ou uma lista (basta ter uma delas).
 */
export function whereHasPermission(code: string | string[]): Prisma.UserWhereInput {
  const cond = { permissions: { some: { permission: { code: Array.isArray(code) ? { in: code } : code } } } };
  return { OR: [{ role: cond }, { extraRoles: { some: { role: cond } } }] };
}

/** Normaliza os cargos adicionais escolhidos: sem repetir e sem o principal. */
export function cleanExtraRoleIds(primaryId: string, extra: string[] | undefined | null): string[] {
  return [...new Set((extra ?? []).filter((id) => id && id !== primaryId))];
}
