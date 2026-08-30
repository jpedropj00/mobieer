import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres").optional(),
  position: z.string().optional().nullable(),
  sector: z.string().optional().nullable(),
  roleId: z.string().min(1, "Perfil obrigatório"),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  imageUrl: z.string().optional().nullable(),
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true });

export const updateUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
