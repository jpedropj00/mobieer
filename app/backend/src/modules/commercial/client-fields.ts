/**
 * Campos do cadastro de cliente que a loja torna obrigatórios (além do nome).
 * Configuração em Setting; a checagem roda no backend ao criar/editar cliente.
 */
import { prisma } from "../../prisma";
import { BadRequestError } from "../../utils/ApiError";

export const REQUIRED_FIELDS_SETTING = "clients.requiredFields";

export const CLIENT_FIELD_LABEL: Record<string, string> = {
  document: "CPF/CNPJ",
  email: "E-mail",
  phone: "Telefone",
  secondaryPhone: "Telefone 2",
  leadSource: "Origem do cliente",
  sellerId: "Consultor",
  zipCode: "CEP",
  street: "Rua",
  addressNumber: "Número",
  district: "Bairro",
  city: "Cidade",
  state: "UF",
};

export async function loadRequiredClientFields(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: REQUIRED_FIELDS_SETTING } });
  if (!row) return [];
  try {
    const v = JSON.parse(row.value);
    return Array.isArray(v) ? v.filter((k) => k in CLIENT_FIELD_LABEL) : [];
  } catch {
    return [];
  }
}

/** Faltou campo obrigatório? `partial` = edição: só confere o que veio no corpo. */
export function missingClientFields(input: Record<string, unknown>, required: string[], partial = false): string[] {
  return required.filter((k) => {
    if (partial && !(k in input)) return false;
    const v = input[k];
    return v == null || (typeof v === "string" && v.trim() === "");
  });
}

export async function assertClientFields(input: Record<string, unknown>, partial = false) {
  const missing = missingClientFields(input, await loadRequiredClientFields(), partial);
  if (missing.length) throw new BadRequestError(`Preencha: ${missing.map((k) => CLIENT_FIELD_LABEL[k]).join(", ")}`);
}
