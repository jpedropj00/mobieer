import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import * as authService from "./auth.service";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  enterpriseRegistrationSchema,
} from "./auth.schema";

export const registerEnterprise = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.registerEnterprise(enterpriseRegistrationSchema.parse(req.body), req.ip);
  return res.status(201).json({ success: true, data: result, message: "Empresa cadastrada com sucesso" });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);
  const result = await authService.login(email, password, req.ip);
  return ok(res, result, "Login realizado com sucesso");
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.user!.id, req.ip);
  return ok(res, { loggedOut: true });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.me(req.user!.id);
  return ok(res, user);
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  const result = await authService.forgotPassword(email);
  return ok(res, result, "Se o email existir, um link de redefinição será enviado");
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(token, password);
  return ok(res, { reset: true }, "Senha redefinida com sucesso");
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  await authService.changePassword(req.user!.id, currentPassword, newPassword);
  return ok(res, { changed: true }, "Senha alterada com sucesso");
});

/** Assinatura desenhada que sai no PDF do orçamento (PNG em data URL). */
export const getSignature = asyncHandler(async (req: Request, res: Response) => {
  const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { signatureImage: true } });
  return ok(res, { signatureImage: u?.signatureImage ?? null });
});

export const saveSignature = asyncHandler(async (req: Request, res: Response) => {
  const { signatureImage } = z
    .object({ signatureImage: z.string().max(400_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Assinatura inválida").nullable() })
    .parse(req.body);
  await prisma.user.update({ where: { id: req.user!.id }, data: { signatureImage } });
  return ok(res, { saved: Boolean(signatureImage) }, signatureImage ? "Assinatura salva" : "Assinatura removida");
});
