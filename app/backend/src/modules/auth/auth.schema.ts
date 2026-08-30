import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Email inválido"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token obrigatório"),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Senha atual obrigatória"),
  newPassword: z.string().min(6, "A nova senha deve ter pelo menos 6 caracteres"),
});

export const enterpriseRegistrationSchema = z.object({
  legalName: z.string().trim().min(2).max(255),
  tradeName: z.string().trim().max(255).optional().nullable(),
  document: z.string().trim().max(30).optional().nullable(),
  slug: z.string().trim().min(3).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Identificador inválido"),
  email: z.string().email(),
  phone: z.string().trim().max(30).optional().nullable(),
  adminName: z.string().trim().min(2).max(255),
  password: z.string().min(8).max(100),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type EnterpriseRegistrationInput = z.infer<typeof enterpriseRegistrationSchema>;
