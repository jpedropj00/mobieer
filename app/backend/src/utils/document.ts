/** CPF: só dígitos. */
export const onlyDigits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/**
 * Valida CPF pelos dígitos verificadores. Recusa sequências repetidas
 * (000.000.000-00, 111...), que passam na conta mas não existem.
 */
export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** 12345678909 -> 123.456.789-09 */
export function formatCpf(value: string | null | undefined): string {
  const d = onlyDigits(value);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : value ?? "";
}
