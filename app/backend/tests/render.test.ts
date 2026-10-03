/**
 * Render com IA: o texto enviado ao modelo protege o projeto (não muda móveis),
 * os acabamentos vêm do orçamento e o arquivo só é apagado quando ninguém usa.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { finishesFromQuote, orphanKeys, renderPrompt, sortRenders, type RenderItem } from "../src/modules/render/render.rules";

const item = (id: string, sourceKey: string, resultKey: string, createdAt: string, parentId: string | null = null): RenderItem => ({ id, room: "Varanda", finishes: "", lighting: "DIA", adjustment: null, sourceKey, sourceMime: "image/png", resultKey, resultMime: "image/png", parentId, createdAt, createdBy: "Ana" });

test("a instrução mantém o projeto intacto e leva ambiente, luz e acabamentos", () => {
  const p = renderPrompt({ room: "Varanda", finishes: "Caixaria: MDF Branco TX.  Portas: provençal em MDF Areia", lighting: "NOITE" });
  assert.match(p, /ambiente: Varanda/);
  assert.match(p, /Não acrescente, não remova e não mova móveis/);
  assert.match(p, /mesma perspectiva/);
  assert.match(p, /Remova cotas, textos/);
  assert.match(p, /Cena noturna/);
  assert.match(p, /Acabamentos a aplicar[^\n]*\nCaixaria: MDF Branco TX\. Portas: provençal em MDF Areia/);
  assert.doesNotMatch(p, /Ajuste pedido/);
});

test("sem acabamentos o bloco some; ajuste entra só quando pedido", () => {
  const p = renderPrompt({ room: "", finishes: "  ", lighting: "DIA", adjustment: "trocar o puxador para preto fosco" });
  assert.match(p, /ambiente: ambiente/);
  assert.doesNotMatch(p, /Acabamentos a aplicar/);
  assert.match(p, /Ajuste pedido sobre esta versão, sem alterar o restante:\ntrocar o puxador para preto fosco/);
  assert.match(p, /Iluminação natural de dia/);
});

test("acabamentos sugeridos vêm dos itens do orçamento daquele ambiente", () => {
  const items = [
    { room: "Varanda", description: "Armário", corpo: "MDF Branco TX", porta: "Provençal MDF Areia", puxador: "Creta dourado" },
    { room: "varanda", description: "Aéreo", corpo: "MDF Naval", complemento: "Prateleiras Carvalho Treviso" },
    { room: "Cozinha", description: "x", corpo: "MDF Cinza" },
    { room: null, description: "Home office", modelo: "Ripado" },
  ];
  assert.equal(finishesFromQuote(items, "Varanda"), "Caixaria: MDF Branco TX. Portas e frentes: Provençal MDF Areia. Puxadores: Creta dourado. Complemento: Prateleiras Carvalho Treviso");
  assert.equal(finishesFromQuote(items, "home office"), "Modelo: Ripado");
  assert.equal(finishesFromQuote(items, "Sala"), "");
});

test("ordem do mais novo para o mais antigo; arquivo compartilhado com um ajuste não é apagado", () => {
  const a = item("a", "k/origem", "k/r1", "2026-10-03T10:00:00Z");
  const b = item("b", "k/r1", "k/r2", "2026-10-03T11:00:00Z", "a"); // ajuste: a base é o resultado de `a`
  assert.deepEqual(sortRenders([a, b]).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(orphanKeys([b], a), ["k/origem"]); // k/r1 ainda é a origem de `b`
  assert.deepEqual(orphanKeys([a], b), ["k/r2"]);
  assert.deepEqual(orphanKeys([], a), ["k/origem", "k/r1"]);
});
