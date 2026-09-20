import assert from "node:assert/strict";
import test from "node:test";
import { buildDre, classifyDreLine, DRE_LINE_KEYS } from "../src/modules/finance/dre.service";

test("DRE: siglas de imposto só casam como palavra inteira", () => {
  // "vendas" contém "das", "comissão" contém "iss", "pisos" contém "pis":
  // nada disso é imposto sobre venda.
  assert.equal(classifyDreLine("DESPESA", "Comissão de vendas"), "DESPESA_VENDAS");
  assert.equal(classifyDreLine("DESPESA", "Frete de vendas"), "DESPESA_VENDAS");
  assert.notEqual(classifyDreLine("DESPESA", "Pisos e revestimentos"), "DEDUCOES");
  assert.notEqual(classifyDreLine("DESPESA", "Entradas diversas"), "DEDUCOES");
});

test("DRE: impostos sobre venda continuam em deduções", () => {
  for (const c of ["DAS - Simples Nacional", "ISS", "ICMS", "PIS", "COFINS", "Imposto municipal", "Tributos"]) {
    assert.equal(classifyDreLine("DESPESA", c), "DEDUCOES", c);
  }
  assert.equal(classifyDreLine("DESPESA", "IRPJ trimestral"), "IMPOSTOS_RENDA");
  assert.equal(classifyDreLine("DESPESA", "IOF"), "DESPESA_FINANCEIRA");
});

test("DRE: taxa de cartão é despesa financeira", () => {
  assert.equal(classifyDreLine("DESPESA", "Taxa de cartão / Vendas"), "DESPESA_FINANCEIRA");
});

test("DRE: classificação por grupo", () => {
  assert.equal(classifyDreLine("DESPESA", "Chapa de MDF"), "CUSTO");
  assert.equal(classifyDreLine("DESPESA", "Salários administrativos"), "DESPESA_ADMIN");
  assert.equal(classifyDreLine("DESPESA", "Marketing e propaganda"), "DESPESA_VENDAS");
  assert.equal(classifyDreLine("DESPESA", "Despesas diversas"), "DESPESA_GERAL");
  assert.equal(classifyDreLine("RECEITA", "Venda de projeto"), "RECEITA_BRUTA");
  assert.equal(classifyDreLine("RECEITA", "Rendimento de aplicação"), "RECEITA_FINANCEIRA");
  assert.equal(classifyDreLine("RECEITA", "Devolução de cliente"), "DEDUCOES");
});

test("DRE: acentos e caixa não mudam a classificação", () => {
  assert.equal(classifyDreLine("DESPESA", "SALÁRIO"), classifyDreLine("DESPESA", "salario"));
  assert.equal(classifyDreLine("DESPESA", "Matéria-prima"), "CUSTO");
});

test("DRE: cascata de subtotais fecha", () => {
  const dre = buildDre(
    [
      { type: "RECEITA", category: "Venda de projeto", amount: 100000, status: "PAID" },
      { type: "DESPESA", category: "DAS - Simples Nacional", amount: 6000, status: "PAID" },
      { type: "DESPESA", category: "Chapa de MDF", amount: 30000, status: "PAID" },
      { type: "DESPESA", category: "Comissão de vendas", amount: 5000, status: "PAID" },
      { type: "DESPESA", category: "Aluguel", amount: 8000, status: "PAID" },
      { type: "DESPESA", category: "Juros de empréstimo", amount: 1000, status: "PAID" },
    ],
    {}
  );
  const v = Object.fromEntries(dre.lines.map((l) => [l.key, l.value]));
  assert.equal(v.RECEITA_LIQUIDA, 94000);
  assert.equal(v.LUCRO_BRUTO, 64000);
  assert.equal(v.EBITDA, 51000); // 64000 - 5000 vendas - 8000 admin
  assert.equal(v.LAIR, 50000);
  assert.equal(v.LUCRO_LIQUIDO, 50000);
  assert.equal(dre.margins.bruta, 68.1);
});

test("DRE: mapeamento manual vence o classificador e categorias sem mapa são listadas", () => {
  const dre = buildDre(
    [
      { type: "DESPESA", category: "Diversos", amount: 100, status: "PAID" },
      { type: "DESPESA", category: "Outros", amount: 50, status: "PAID" },
    ],
    { Diversos: "CUSTO" }
  );
  assert.equal(dre.buckets.CUSTO, 100);
  assert.deepEqual(dre.unmappedCategories, ["Outros"]);
});

test("DRE: mapeamento inválido é ignorado (não quebra o relatório)", () => {
  const dre = buildDre([{ type: "DESPESA", category: "Aluguel", amount: 10, status: "PAID" }], { Aluguel: "LINHA_QUE_NAO_EXISTE" });
  assert.equal(dre.buckets.DESPESA_ADMIN, 10);
  assert.equal(Object.keys(dre.buckets).length, DRE_LINE_KEYS.length);
});

test("DRE: sem receita as margens ficam nulas (sem divisão por zero)", () => {
  const dre = buildDre([{ type: "DESPESA", category: "Aluguel", amount: 10, status: "PAID" }], {});
  assert.deepEqual(dre.margins, { bruta: null, operacional: null, liquida: null });
});
