import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import * as usersService from "./users.service";
import { createUserSchema, updateUserSchema, updateUserStatusSchema } from "./users.schema";

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 20));
  const result = await usersService.listUsers({
    page,
    perPage,
    search: req.query.search as string | undefined,
    status: req.query.status as string | undefined,
    roleId: req.query.roleId as string | undefined,
  });
  return res.json({ success: true, data: result.items, meta: result.meta });
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.getUser(req.params.id);
  return ok(res, user);
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const input = createUserSchema.parse(req.body);
  const user = await usersService.createUser(input, req.user!.id);
  return ok(res, user, "Usuário criado com sucesso");
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const input = updateUserSchema.parse(req.body);
  const user = await usersService.updateUser(req.params.id, input, req.user!.id);
  return ok(res, user, "Usuário atualizado com sucesso");
});

export const updateUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = updateUserStatusSchema.parse(req.body);
  const user = await usersService.updateUser(req.params.id, { status }, req.user!.id);
  return ok(res, user, "Status atualizado");
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  await usersService.deleteUser(req.params.id, req.user!.id);
  return ok(res, { deleted: true }, "Usuário desativado");
});

export const listRoles = asyncHandler(async (_req: Request, res: Response) => {
  const roles = await usersService.listRoles();
  return ok(res, roles);
});

export const updateRolePermissions = asyncHandler(async (req: Request, res: Response) => {
  const codes = (req.body.permissions as string[]) ?? [];
  const role = await usersService.updateRolePermissions(req.params.roleId, codes, req.user!.id);
  return ok(res, role, "Permissões atualizadas");
});

export const listPermissions = asyncHandler(async (_req: Request, res: Response) => {
  const permissions = await usersService.listPermissions();
  return ok(res, permissions);
});
