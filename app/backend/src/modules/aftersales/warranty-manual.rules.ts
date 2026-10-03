/**
 * Preenchimento do "Manual de uso e certificado de garantia" da loja. O modelo
 * é o da Mobieer, sem mudança; aqui só se decide o que vai em cada campo.
 * Regras puras.
 */

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** "(85) 99721-4961" → DDD e número, para o campo "(___) ________". */
export function splitPhone(phone: string | null | undefined): { ddd: string; number: string } | null {
  if (!phone?.trim()) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return { ddd: "", number: phone.trim() };
  const rest = d.slice(2);
  return { ddd: d.slice(0, 2), number: `${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}` };
}

/** Dia, mês e ano no fuso da loja, para o campo "__/__/__". */
export function dateParts(d: Date | null | undefined): [string, string, string] | null {
  if (!d) return null;
  const [day, month, year] = d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric" }).split("/");
  return [day, month, year];
}

/** Ambientes impressos no modelo, na ordem em que aparecem. */
export const MANUAL_ROOMS = ["Cozinha", "Closet", "Área Gourmet", "Sala de Estar", "Home Office", "Escritório", "Sala de Jantar", "Banheiro", "Quarto", "Lavanderia"] as const;

const ROOM_ALIASES: Record<string, (typeof MANUAL_ROOMS)[number]> = {
  cozinha: "Cozinha",
  closet: "Closet",
  "area gourmet": "Área Gourmet",
  gourmet: "Área Gourmet",
  varanda: "Área Gourmet",
  "sala de estar": "Sala de Estar",
  sala: "Sala de Estar",
  "home office": "Home Office",
  home: "Home Office",
  escritorio: "Escritório",
  "sala de jantar": "Sala de Jantar",
  banheiro: "Banheiro",
  lavabo: "Banheiro",
  quarto: "Quarto",
  dormitorio: "Quarto",
  suite: "Quarto",
  lavanderia: "Lavanderia",
  "area de servico": "Lavanderia",
};

/**
 * Separa os ambientes entregues entre os que têm caixinha no modelo e o que
 * vai escrito em "Outros". "Dormitório casal" marca Quarto; "Adega" vai para Outros.
 */
export function matchRooms(ambientes: string | null | undefined): { checked: (typeof MANUAL_ROOMS)[number][]; others: string } {
  const checked = new Set<(typeof MANUAL_ROOMS)[number]>();
  const others: string[] = [];
  for (const raw of (ambientes ?? "").split(/[,;·\n/]|\s+e\s+/)) {
    const token = raw.trim();
    if (!token) continue;
    const p = plain(token);
    const key = Object.keys(ROOM_ALIASES)
      .sort((a, b) => b.length - a.length)
      .find((k) => p === k || p.startsWith(`${k} `) || p.startsWith(`${k}s`));
    if (key) checked.add(ROOM_ALIASES[key]);
    else others.push(token);
  }
  return { checked: MANUAL_ROOMS.filter((r) => checked.has(r)), others: others.join(", ") };
}

/**
 * Cidade/UF no fim do endereço antigo, texto livre ("Av. X, 100 — Fortaleza/CE"
 * ou "..., Fortaleza - CE"). Devolve o endereço sem esse pedaço e a cidade.
 */
export function splitCityFromAddress(address: string | null | undefined): { street: string | null; city: string | null } {
  const a = address?.trim();
  if (!a) return { street: null, city: null };
  const m = /^(.*?)[\s,—–-]+([A-Za-zÀ-ÿ' ]{3,})\s*[/-]\s*([A-Za-z]{2})\s*$/.exec(a);
  if (!m || !m[1].trim()) return { street: a, city: null };
  return { street: m[1].trim().replace(/[,—–-]\s*$/, "").trim(), city: `${m[2].trim()} / ${m[3].toUpperCase()}` };
}

/** Rótulo do modelo → nome do campo. A comparação ignora acento, caixa e os dois-pontos. */
export const FIELD_LABELS: Record<string, string> = {
  cliente: "cliente",
  "cpf / cnpj": "documento",
  telefone: "telefone",
  "e-mail": "email",
  endereco: "endereco",
  "cidade / uf": "cidade",
  cep: "cep",
  "no do contrato": "contrato",
  "consultor(a)": "consultor",
  projetista: "projetista",
  "montador(es)": "montadores",
  "data da compra": "dataCompra",
  "data da entrega": "dataEntrega",
  "data da vistoria final": "dataVistoria",
};

export const labelKey = (label: string) => plain(label.replace(/[º°]/g, "o").replace(/:\s*$/, ""));
