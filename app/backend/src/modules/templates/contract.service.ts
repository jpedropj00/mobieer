/**
 * Contrato automático: pega o modelo de contrato (corpo de texto com
 * marcadores {{...}}), substitui pelos dados do cliente/projeto/empresa e pelos
 * valores vindos do Promob, e gera um PDF que fica anexado ao cliente.
 *
 * O modelo é texto puro com marcadores — nada de .docx: assim a substituição é
 * confiável e o resultado sai sempre igual.
 */
import PDFDocument from "pdfkit";
import { prisma } from "../../prisma";
import { NotFoundError } from "../../utils/ApiError";

// ---------------- Formatação ----------------

export const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const brDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "");

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const dateLong = (d: Date) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;

// ---------------- Valor por extenso ----------------

const UNI = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_A_DEZENOVE = [
  "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove",
];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
  "seiscentos", "setecentos", "oitocentos", "novecentos",
];

/** 1..999 por extenso. */
function upTo999(n: number): string {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const d = Math.floor((n % 100) / 10);
  const u = n % 10;
  const parts: string[] = [];
  if (c) parts.push(CENTENAS[c]);
  if (d === 1) {
    parts.push(DEZ_A_DEZENOVE[u]);
  } else {
    if (d) parts.push(DEZENAS[d]);
    if (u) parts.push(UNI[u]);
  }
  return parts.join(" e ");
}

/** Número inteiro por extenso (até bilhões). */
export function numberToWords(n: number): string {
  if (n === 0) return "zero";
  const grupos: [number, string, string][] = [
    [1_000_000_000, "bilhão", "bilhões"],
    [1_000_000, "milhão", "milhões"],
    [1_000, "mil", "mil"],
  ];
  const parts: string[] = [];
  let rest = Math.floor(n);
  for (const [valor, sing, plur] of grupos) {
    const q = Math.floor(rest / valor);
    if (q > 0) {
      parts.push(valor === 1000 && q === 1 ? "mil" : `${upTo999(q)} ${q === 1 ? sing : plur}`);
      rest %= valor;
    }
  }
  const remainder = rest; // < 1000, depois de consumir bilhão/milhão/mil
  if (remainder > 0) parts.push(upTo999(remainder));
  if (parts.length <= 1) return parts.join("");
  const last = parts.pop()!;
  // "e" antes do último grupo quando ele é < 100, múltiplo redondo de 100, ou
  // quando não sobrou resto ("um milhão E quinhentos mil").
  const usaE = remainder === 0 || remainder < 100 || remainder % 100 === 0;
  return `${parts.join(", ")}${usaE ? " e " : ", "}${last}`;
}

/**
 * Valor em reais por extenso: 1234.5 -> "mil, duzentos e trinta e quatro reais
 * e cinquenta centavos". Milhão/bilhão redondo leva "de": "um milhão de reais".
 */
export function moneyToWords(value: number): string {
  const negativo = value < 0;
  const cents = Math.round(Math.abs(value) * 100);
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  const parts: string[] = [];
  if (reais > 0) {
    const words = numberToWords(reais);
    // "um milhão DE reais" só quando o número termina exatamente em milhão/bilhão.
    const de = /(milhão|milhões|bilhão|bilhões)$/.test(words) ? "de " : "";
    parts.push(`${words} ${de}${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) parts.push(`${numberToWords(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  if (!parts.length) return "zero real";
  return `${negativo ? "menos " : ""}${parts.join(" e ")}`;
}

// ---------------- Campos disponíveis ----------------

export const MERGE_FIELDS: { key: string; label: string; example: string }[] = [
  { key: "cliente.nome", label: "Nome do cliente", example: "Maria Silva" },
  { key: "cliente.documento", label: "CPF/CNPJ do cliente", example: "123.456.789-00" },
  { key: "cliente.email", label: "E-mail do cliente", example: "maria@email.com" },
  { key: "cliente.telefone", label: "Telefone do cliente", example: "(85) 99999-0000" },
  { key: "cliente.endereco", label: "Endereço do cliente", example: "Rua X, 100 — Fortaleza/CE" },
  { key: "cliente.contato", label: "Contato principal", example: "Maria" },
  { key: "projeto.codigo", label: "Código do projeto", example: "PRJ-0001" },
  { key: "projeto.nome", label: "Nome do projeto", example: "Cozinha + dormitórios" },
  { key: "projeto.descricao", label: "Descrição do projeto", example: "..." },
  { key: "projeto.inicio", label: "Início do projeto", example: "01/10/2026" },
  { key: "projeto.prazo", label: "Prazo do projeto", example: "15/12/2026" },
  { key: "empresa.razaoSocial", label: "Razão social da empresa", example: "MOBIEER LTDA" },
  { key: "empresa.nomeFantasia", label: "Nome fantasia", example: "MOBIEER" },
  { key: "empresa.cnpj", label: "CNPJ da empresa", example: "00.000.000/0001-00" },
  { key: "empresa.email", label: "E-mail da empresa", example: "contato@mobieer.com.br" },
  { key: "empresa.telefone", label: "Telefone da empresa", example: "(85) 3000-0000" },
  { key: "empresa.cidade", label: "Cidade da empresa", example: "Fortaleza" },
  { key: "empresa.uf", label: "UF da empresa", example: "CE" },
  { key: "promob.total", label: "Valor total do Promob", example: "R$ 45.000,00" },
  { key: "promob.totalExtenso", label: "Valor total por extenso", example: "quarenta e cinco mil reais" },
  { key: "promob.ambientes", label: "Ambientes do orçamento", example: "Cozinha, Dormitório 1" },
  { key: "promob.qtdItens", label: "Quantidade de itens", example: "128" },
  { key: "promob.arquivo", label: "Arquivo do orçamento", example: "orcamento.xml" },
  { key: "promob.tabelaAmbientes", label: "Tabela de ambientes com valores", example: "Cozinha .... R$ 20.000,00" },
  { key: "pagamento.entrada", label: "Valor de entrada", example: "R$ 15.000,00" },
  { key: "pagamento.parcelas", label: "Nº de parcelas", example: "10" },
  { key: "pagamento.valorParcela", label: "Valor da parcela", example: "R$ 3.000,00" },
  { key: "pagamento.condicao", label: "Condição de pagamento (texto livre)", example: "Entrada + 10x no boleto" },
  { key: "contrato.data", label: "Data do contrato", example: "13/09/2026" },
  { key: "contrato.dataExtenso", label: "Data por extenso", example: "13 de setembro de 2026" },
  { key: "contrato.cidade", label: "Cidade do contrato", example: "Fortaleza" },
  { key: "contrato.prazoEntregaDias", label: "Prazo de entrega (dias)", example: "45" },
];

export type ContractOverrides = {
  entrada?: number | null;
  parcelas?: number | null;
  valorParcela?: number | null;
  condicaoPagamento?: string | null;
  prazoEntregaDias?: number | null;
  cidade?: string | null;
  /** Sobrescreve o total do Promob (ex.: valor negociado). */
  totalOverride?: number | null;
};

export type ContractContext = {
  values: Record<string, string>;
  meta: {
    clientId: string;
    clientName: string;
    projectId: string | null;
    projectCode: string | null;
    promobImportId: string | null;
    total: number | null;
    totalSource: "PROMOB" | "MANUAL" | "NENHUM";
  };
};

/**
 * Monta o contexto de substituição. `promobImportId` opcional: se não vier, usa
 * a importação mais recente do projeto que tenha valor.
 */
export async function buildContractContext(
  organizationId: string,
  input: { clientId: string; projectId?: string | null; promobImportId?: string | null } & ContractOverrides
): Promise<ContractContext> {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, organizationId },
    include: { organization: { include: { enterprise: true } } },
  });
  if (!client) throw new NotFoundError("Cliente não encontrado");

  const project = input.projectId
    ? await prisma.project.findFirst({ where: { id: input.projectId, clientId: client.id, organizationId } })
    : null;
  if (input.projectId && !project) throw new NotFoundError("Projeto não encontrado para este cliente");

  // Orçamento do Promob: explícito, ou o mais recente do projeto com valor.
  let promob = null as Awaited<ReturnType<typeof prisma.promobImport.findFirst>>;
  if (input.promobImportId) {
    promob = await prisma.promobImport.findFirst({ where: { id: input.promobImportId, organizationId } });
    if (!promob) throw new NotFoundError("Importação do Promob não encontrada");
  } else if (project) {
    promob =
      (await prisma.promobImport.findFirst({
        where: { projectId: project.id, organizationId, totalValue: { not: null } },
        orderBy: { createdAt: "desc" },
      })) ??
      (await prisma.promobImport.findFirst({ where: { projectId: project.id, organizationId }, orderBy: { createdAt: "desc" } }));
  }

  const parsed = (promob?.parsedJson ?? null) as {
    ambientes?: string[];
    totals?: { itens?: number; valor?: number | null };
    valoresPorAmbiente?: { ambiente: string; valor: number }[];
  } | null;

  const promobTotal = promob?.totalValue != null ? Number(promob.totalValue) : (parsed?.totals?.valor ?? null);
  const total = input.totalOverride != null ? input.totalOverride : promobTotal;
  const totalSource: ContractContext["meta"]["totalSource"] =
    input.totalOverride != null ? "MANUAL" : promobTotal != null ? "PROMOB" : "NENHUM";

  const ent = client.organization.enterprise;
  const now = new Date();
  const cidade = input.cidade?.trim() || ent.municipio || "Fortaleza";

  const tabelaAmbientes = (parsed?.valoresPorAmbiente ?? [])
    .map((a) => `${a.ambiente} — ${brl(a.valor)}`)
    .join("\n");

  const values: Record<string, string> = {
    "cliente.nome": client.name,
    "cliente.documento": client.document ?? "",
    "cliente.email": client.email ?? "",
    "cliente.telefone": client.phone ?? "",
    "cliente.endereco": client.address ?? "",
    "cliente.contato": client.primaryContact ?? client.name,
    "projeto.codigo": project?.code ?? "",
    "projeto.nome": project?.name ?? "",
    "projeto.descricao": project?.description ?? "",
    "projeto.inicio": brDate(project?.startAt),
    "projeto.prazo": brDate(project?.dueAt),
    "empresa.razaoSocial": ent.legalName,
    "empresa.nomeFantasia": ent.tradeName ?? ent.legalName,
    "empresa.cnpj": ent.document ?? "",
    "empresa.email": ent.email ?? "",
    "empresa.telefone": ent.phone ?? "",
    "empresa.cidade": ent.municipio ?? "Fortaleza",
    "empresa.uf": ent.uf ?? "CE",
    "promob.total": total != null ? brl(total) : "",
    "promob.totalExtenso": total != null ? moneyToWords(total) : "",
    "promob.ambientes": (parsed?.ambientes ?? []).join(", "),
    "promob.qtdItens": String(parsed?.totals?.itens ?? promob?.itemCount ?? ""),
    "promob.arquivo": promob?.fileName ?? "",
    "promob.tabelaAmbientes": tabelaAmbientes,
    "pagamento.entrada": input.entrada != null ? brl(input.entrada) : "",
    "pagamento.parcelas": input.parcelas != null ? String(input.parcelas) : "",
    "pagamento.valorParcela": input.valorParcela != null ? brl(input.valorParcela) : "",
    "pagamento.condicao": input.condicaoPagamento ?? "",
    "contrato.data": brDate(now),
    "contrato.dataExtenso": dateLong(now),
    "contrato.cidade": cidade,
    "contrato.prazoEntregaDias": input.prazoEntregaDias != null ? String(input.prazoEntregaDias) : "",
  };

  return {
    values,
    meta: {
      clientId: client.id,
      clientName: client.name,
      projectId: project?.id ?? null,
      projectCode: project?.code ?? null,
      promobImportId: promob?.id ?? null,
      total,
      totalSource,
    },
  };
}

// Substituição de marcadores compartilhada com as automações de mensagem.
export { renderTemplate } from "../../utils/template";

/**
 * Gera o PDF do contrato. O corpo é texto puro: linhas em MAIÚSCULAS curtas
 * viram títulos de cláusula, o resto é parágrafo justificado.
 */
export function contractPdf(opts: { title: string; body: string; footer?: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(14).text(opts.title.toUpperCase(), { align: "center" });
    doc.moveDown(1.2);

    for (const rawLine of opts.body.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (!line.trim()) {
        doc.moveDown(0.6);
        continue;
      }
      const isHeading = line.length <= 90 && line === line.toUpperCase() && /[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(line);
      if (isHeading) {
        doc.moveDown(0.4);
        doc.font("Helvetica-Bold").fontSize(11).text(line, { align: "left" });
        doc.moveDown(0.2);
      } else {
        doc.font("Helvetica").fontSize(10.5).text(line, { align: "justify", lineGap: 2 });
      }
    }

    if (opts.footer) {
      doc.moveDown(1.5);
      doc.font("Helvetica").fontSize(8).fillColor("#666").text(opts.footer, { align: "center" });
    }
    doc.end();
  });
}

/** Modelo inicial de contrato, para a empresa editar. */
export const DEFAULT_CONTRACT_BODY = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS E FORNECIMENTO DE MÓVEIS PLANEJADOS

CONTRATADA: {{empresa.razaoSocial}}, inscrita no CNPJ sob o nº {{empresa.cnpj}}, com sede em {{empresa.cidade}}/{{empresa.uf}}, telefone {{empresa.telefone}}, e-mail {{empresa.email}}.

CONTRATANTE: {{cliente.nome}}, inscrito(a) no CPF/CNPJ sob o nº {{cliente.documento}}, residente e domiciliado(a) em {{cliente.endereco}}, telefone {{cliente.telefone}}, e-mail {{cliente.email}}.

As partes acima qualificadas têm entre si justo e contratado o seguinte:

CLÁUSULA PRIMEIRA — DO OBJETO

O presente contrato tem por objeto o projeto, a fabricação, a entrega e a montagem de móveis planejados referentes ao projeto {{projeto.codigo}} — {{projeto.nome}}, contemplando os seguintes ambientes: {{promob.ambientes}}.

O detalhamento técnico dos itens consta do projeto executivo e do orçamento {{promob.arquivo}}, que integram este contrato para todos os fins.

CLÁUSULA SEGUNDA — DO PREÇO

Pelo objeto descrito na cláusula primeira, a CONTRATANTE pagará à CONTRATADA o valor total de {{promob.total}} ({{promob.totalExtenso}}).

Composição por ambiente:
{{promob.tabelaAmbientes}}

CLÁUSULA TERCEIRA — DA FORMA DE PAGAMENTO

Entrada de {{pagamento.entrada}} e o saldo em {{pagamento.parcelas}} parcelas de {{pagamento.valorParcela}}.

{{pagamento.condicao}}

CLÁUSULA QUARTA — DO PRAZO

A CONTRATADA entregará e montará os móveis no prazo de {{contrato.prazoEntregaDias}} dias corridos, contados da aprovação do projeto técnico pela CONTRATANTE e da confirmação da medição final no local.

Alterações solicitadas após a aprovação do projeto técnico poderão gerar custo adicional e novo prazo, mediante aditivo.

CLÁUSULA QUINTA — DAS OBRIGAÇÕES DA CONTRATANTE

A CONTRATANTE se obriga a disponibilizar o local de instalação em condições adequadas (alvenaria, elétrica, hidráulica e revestimentos concluídos), bem como a conferir e aprovar o projeto técnico antes do início da produção.

CLÁUSULA SEXTA — DA GARANTIA

A CONTRATADA garante os móveis contra defeitos de fabricação pelo prazo legal, contado da data de conclusão da montagem, ressalvados os danos decorrentes de mau uso, umidade excessiva ou intervenção de terceiros.

CLÁUSULA SÉTIMA — DO FORO

Fica eleito o foro da comarca de {{contrato.cidade}}/{{empresa.uf}} para dirimir eventuais controvérsias oriundas deste contrato.

E por estarem assim justas e contratadas, as partes assinam o presente instrumento.

{{contrato.cidade}}, {{contrato.dataExtenso}}.


_______________________________________
{{empresa.razaoSocial}}
CONTRATADA


_______________________________________
{{cliente.nome}}
CONTRATANTE
`;
