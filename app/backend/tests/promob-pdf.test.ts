/**
 * PDFs do Promob: Orçamento (itens com preço, total, pagamento, insumos) e
 * Plano de corte (uma chapa por página). Linhas sintéticas no mesmo desenho
 * (posições x/y) dos arquivos reais.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { detectPdfKind, parseBudgetLines, parseCutPlanLines, type PdfLine } from "../src/modules/promob/promob.pdf";

let y = 800;
const L = (page: number, ...cells: [number, string][]): PdfLine => ({ page, y: (y -= 12), cells: cells.map(([x, s]) => ({ x, s })) });
const header = (p: number) => L(p, [63, "Item"], [88, "Rep"], [119, "Qtd"], [196, "Referência"], [334, "Descrição"], [430, "Dimensões"], [512, "Preço"]);
const headerSemPreco = (p: number) => L(p, [64, "Item"], [90, "Rep"], [127, "Qtd"], [204, "Referência"], [356, "Descrição"], [473, "Dimensões"]);

function orcamento(): PdfLine[] {
  y = 800;
  return [
    L(1, [63, "Data: 01/10/2026"], [141, "Hora: 17:37:12"], [484, "Orçamento"]),
    L(1, [66, "Dados do cliente:"]),
    L(1, [71, "Nome:"], [99, "MARIA TESTE"], [322, "CPF:"]),
    L(1, [71, "Telefone:"], [322, "Celular:"], [355, "85999990000"]),
    L(1, [71, "E"], [76, "-"], [79, "mail:"], [101, "maria@exemplo.com"]),
    L(1, [61, "Projeto"], [95, "-"], [100, "APTO 12"]),
    L(1, [66, "-"], [71, "Cozinhas"]),
    header(1),
    L(1, [65, "309"], [93, "1"], [116, "1 UN"], [142, "ARM01"], [288, "Portas de Giro"], [421, "799 x 400 x 420"], [511, "48,52"]),
    // descrição quebrada: um pedaço em cima e outro embaixo da linha do item
    L(1, [288, "Porta c/ Pux Vertical Dob Total"]),
    L(1, [67, "33"], [93, "1"], [116, "2 UN"], [142, "7101.22.251"], [421, "356 x 2245 x 22"], [516, "0,00"]),
    L(1, [288, "Perfil 45"]),
    L(1, [505, "1.048,52"]),
    L(1, [66, "-"], [71, "Dormitórios"]),
    header(1),
    L(1, [65, "951"], [93, "1"], [116, "1 UN"], [142, "DCA001"], [288, "Portas de Giro s/ Rodapé"], [419, "1431 x 2700 x 500"], [506, "1.000,00"]),
    L(1, [505, "1.000,00"]),
    L(1, [66, "Total final:"], [488, "R$"], [500, "2.048,52"]),
    L(1, [66, "Entradas Diferenciadas"]),
    L(1, [162, "Descrição"], [406, "Valor"]),
    L(1, [136, "Desconto Comercial 1"], [407, "100,00"]),
    L(1, [66, "Condições de Pagamento"]),
    L(1, [103, "Descrição"], [205, "Valor para parcelar"], [323, "Valor das Parcelas"], [455, "Valor Total"]),
    L(1, [114, "1+2"], [222, "2.048,52"], [344, "682,84"], [458, "2.048,52"]),
    headerSemPreco(2),
    L(2, [63, "1948"], [95, "1"], [114, "0.5 M2"], [154, "MDF.COR.15.103"], [294, "Chapa Areia Espessura 15mm"], [466, "595 x 15 x 356"]),
    L(2, [63, "1949"], [95, "1"], [114, "1.25 M2"], [154, "MDF.COR.15.103"], [294, "Chapa Areia Espessura 15mm"], [466, "900 x 15 x 356"]),
    L(2, [63, "2424"], [95, "1"], [119, "2.061 M"], [154, "FTABS.0.45.29.103"], [459, "2060,2 x 29 x 0,45"]),
    L(2, [63, "2593"], [95, "1"], [124, "6 UN"], [154, "3"], [294, "Furar"], [490, "'"], [492, "-"], [495, "'"]),
    L(2, [63, "2169"], [95, "1"], [116, "4.5 M"], [154, "1"], [294, "Cortar"], [490, "'"], [492, "-"], [495, "'"]),
    L(2, [63, "2926"], [95, "1"], [124, "6 UN"], [154, "PAR.DOB.14"], [294, "Parafuso para Dobradiça 4x14mm"], [482, "4 x 14"]),
  ];
}

test("orçamento: cliente, projeto, seções com subtotal, total e pagamento", () => {
  const lines = orcamento();
  assert.equal(detectPdfKind(lines), "BUDGET");
  const b = parseBudgetLines(lines);
  assert.deepEqual(b.cliente, { nome: "MARIA TESTE", celular: "85999990000", email: "maria@exemplo.com" });
  assert.equal(b.projeto, "APTO 12");
  assert.equal(b.totalFinal, 2048.52);
  assert.deepEqual(b.valoresPorAmbiente, [{ ambiente: "Cozinhas", valor: 1048.52 }, { ambiente: "Dormitórios", valor: 1000 }]);
  assert.deepEqual(b.pagamento, [{ descricao: "1+2", valorParcelar: 2048.52, valorParcela: 682.84, valorTotal: 2048.52 }]);
  assert.deepEqual(b.descontos, [{ descricao: "Desconto Comercial 1", valor: 100 }]);
  assert.equal(b.totals.itens, 3);
});

test("descrição quebrada em duas linhas é remontada na ordem; item sem preço gera aviso", () => {
  const b = parseBudgetLines(orcamento());
  const porta = b.itens.find((i) => i.referencia === "7101.22.251")!;
  assert.equal(porta.descricao, "Porta c/ Pux Vertical Dob Total Perfil 45 — 356 x 2245 x 22");
  assert.equal(porta.quantidade, 2);
  assert.equal(porta.ambiente, "Cozinhas");
  assert.equal(b.itensSemPreco, 1);
  assert.match(b.warnings[0], /1 de 3 itens vieram sem preço/);
});

test("insumos sem preço: chapas em m², fita, operações e ferragens", () => {
  const b = parseBudgetLines(orcamento());
  assert.deepEqual(b.insumos.chapas, [{ material: "Chapa Areia Espessura 15mm", m2: 1.75 }]);
  assert.equal(b.insumos.fitasM, 2.061);
  assert.deepEqual(b.insumos.operacoes, [{ descricao: "Furar", unidade: "UN", quantidade: 6 }, { descricao: "Cortar", unidade: "M", quantidade: 4.5 }]);
  assert.deepEqual(b.insumos.ferragens, [{ descricao: "Parafuso para Dobradiça 4x14mm", quantidade: 6 }]);
  // a lista sem preço não entra nos itens do orçamento
  assert.equal(b.itens.length, 3);
});

function chapa(page: number, n: number, material: string, esp: string, pecas: number, aprov: string): PdfLine[] {
  y = 800;
  return [
    L(page, [24, "Cliente:"], [67, "MARIA TESTE"]),
    L(page, [24, "Projeto:"], [68, "COZINHA"]),
    L(page, [24, "Chapa"], [59, String(n)], [358, "Acabamento:"], [428, material], [772, "Peças:"], [808, String(pecas)]),
    L(page, [24, "Descrição:"], [80, material], [119, `${esp}mm`], [155, "- Cod.:"], [194, "11915"], [358, "Material:"], [406, "MDF"], [767, "Cortes:"], [808, "36"]),
    L(page, [24, "Dimensão:"], [82, `2700 x 1800 x ${esp}`], [693, "Aproveitamento:"], [781, aprov]),
    L(page, [52, "A"], [75, "812,1"], [101, "x 416,1"]),
  ];
}

test("plano de corte: uma chapa por página, somadas por material", () => {
  const lines = [...chapa(1, 1, "Branco", "15", 24, "90,00%"), ...chapa(2, 2, "Branco", "15", 10, "50,00%"), ...chapa(3, 1, "Cinza", "6", 1, "12,67%")];
  assert.equal(detectPdfKind(lines), "CUT_PLAN");
  const p = parseCutPlanLines(lines);
  assert.equal(p.cliente.nome, "MARIA TESTE");
  assert.equal(p.projeto, "COZINHA");
  assert.equal(p.chapas.length, 3);
  assert.deepEqual(p.chapas[0], { chapa: 1, material: "Branco 15mm", codigo: "11915", dimensao: "2700 x 1800 x 15", x: 2700, y: 1800, espessura: 15, pecas: 24, cortes: 36, aproveitamento: 90 });
  assert.deepEqual(p.materiais.map((m) => [m.material, m.chapas, m.pecas, m.aproveitamento]), [["Branco 15mm", 2, 34, 70], ["Cinza 6mm", 1, 1, 12.67]]);
  assert.equal(p.totals.itens, 35);
});

test("PDF que não é do Promob", () => {
  assert.equal(detectPdfKind([{ page: 1, y: 700, cells: [{ x: 50, s: "Nota fiscal de serviço" }] }]), "UNKNOWN");
});
