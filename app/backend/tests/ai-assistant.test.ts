/**
 * Mobieer AI: conferência de escopo feita pelo backend, corte da documentação
 * em trechos e as fontes devolvidas. Nada aqui chama o Gemini nem o banco.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  NO_INFO_ANSWER,
  OUT_OF_SCOPE_ANSWER,
  chunkMarkdown,
  contextBlock,
  conversationTitle,
  finalAnswer,
  lexicalSearch,
  parseScope,
  sourcesOf,
  stem,
  tokenize,
  systemPrompt,
  toVectorLiteral,
  type RetrievedChunk,
} from "../src/modules/ai/assistant.rules";

const chunk = (document: string, title: string, section: string, similarity: number): RetrievedChunk => ({ document, title, section, content: "texto", similarity });

test("a marca de escopo é lida e retirada da resposta", () => {
  assert.deepEqual(parseScope("ESCOPO: SIM\nAbra Clientes e projetos."), { inScope: true, tagged: true, answer: "Abra Clientes e projetos." });
  assert.deepEqual(parseScope("**ESCOPO: NÃO**\nA capital é Paris."), { inScope: false, tagged: true, answer: "A capital é Paris." });
  assert.deepEqual(parseScope("escopo: nao"), { inScope: false, tagged: true, answer: "" });
  // sem marca: vale como dentro do escopo, com o texto inteiro
  assert.deepEqual(parseScope("Olá! Como posso ajudar?"), { inScope: true, tagged: false, answer: "Olá! Como posso ajudar?" });
});

test("fora do escopo: o backend troca a resposta pela recusa fixa e descarta fontes e ferramentas", () => {
  const sources = [{ title: "Clientes e projetos", document: "projetos.md" }];
  const out = finalAnswer("ESCOPO: NAO\nClaro! A receita de bolo leva 3 ovos...", sources, ["get_user_projects"]);
  assert.deepEqual(out, { answer: OUT_OF_SCOPE_ANSWER, sources: [], toolsUsed: [], inScope: false });
});

test("dentro do escopo: resposta, fontes e ferramentas seguem; resposta vazia vira 'sem informação'", () => {
  const sources = [{ title: "Financeiro", document: "financeiro.md" }];
  assert.deepEqual(finalAnswer("ESCOPO: SIM\nUse Marcar pago.", sources, []), { answer: "Use Marcar pago.", sources, toolsUsed: [], inScope: true });
  assert.deepEqual(finalAnswer("ESCOPO: SIM\n", sources, ["get_my_tasks"]), { answer: NO_INFO_ANSWER, sources: [], toolsUsed: ["get_my_tasks"], inScope: true });
});

test("a instrução de sistema restringe ao Mobieer e não leva dado sensível", () => {
  const p = systemPrompt({ name: "Ana", roleLabel: "Consultora" });
  assert.match(p, /somente sobre o Mobieer/i);
  assert.match(p, /Nunca invente/);
  assert.match(p, /ESCOPO: SIM/);
  assert.match(p, /Ana \(Consultora\)/);
  assert.doesNotMatch(p, /api[_ ]?key|token de acesso|senha/i);
});

test("bloco de contexto: trechos numerados, ou o aviso de que nada foi encontrado", () => {
  assert.match(contextBlock([]), /nenhum trecho relevante/);
  const b = contextBlock([chunk("projetos.md", "Clientes e projetos", "Como criar um projeto", 0.8)]);
  assert.match(b, /\[1\] Clientes e projetos — Como criar um projeto\ntexto/);
});

test("fontes sem repetição, na ordem de relevância", () => {
  const s = sourcesOf([chunk("projetos.md", "Clientes e projetos", "Abas", 0.9), chunk("faq.md", "Perguntas frequentes", "x", 0.8), chunk("projetos.md", "Clientes e projetos", "Situação", 0.7)]);
  assert.deepEqual(s, [{ title: "Clientes e projetos", document: "projetos.md" }, { title: "Perguntas frequentes", document: "faq.md" }]);
});

test("Markdown cortado por título, com a seção pai no nome e seção grande dividida por parágrafo", () => {
  const md = ["# Financeiro", "", "## Onde fica", "Menu Financeiro.", "", "## Boleto", "Intro.", "", "### Ler boleto", "Use o botão.", "", "## Vazia", ""].join("\n");
  const r = chunkMarkdown(md);
  assert.equal(r.title, "Financeiro");
  assert.deepEqual(r.chunks, [
    { section: "Onde fica", content: "Menu Financeiro." },
    { section: "Boleto", content: "Intro." },
    { section: "Boleto › Ler boleto", content: "Use o botão." },
  ]);
  const big = chunkMarkdown(`# T\n\n## S\n${"a".repeat(60)}\n\n${"b".repeat(60)}\n\n${"c".repeat(60)}`, 130);
  assert.deepEqual(big.chunks.map((c) => [c.section, c.content.length]), [["S", 122], ["S", 60]]);
});

test("a documentação em knowledge/docs é cortável: todo arquivo tem título e trechos dentro do limite", () => {
  const dir = path.join(process.cwd(), "knowledge", "docs");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const r = chunkMarkdown(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.notEqual(r.title, "Documento", `${f} sem título`);
    assert.ok(r.chunks.length > 0, `${f} sem trechos`);
    for (const c of r.chunks) assert.ok(c.content.length <= 1400, `${f} › ${c.section} grande demais`);
  }
});

test("título da conversa e vetor para o pgvector", () => {
  assert.equal(conversationTitle("  Como   crio um projeto? "), "Como crio um projeto?");
  assert.equal(conversationTitle("x".repeat(80)).length, 58);
  assert.equal(toVectorLiteral([0.5, -1, 2]), "[0.5,-1,2]");
  assert.throws(() => toVectorLiteral([]));
  assert.throws(() => toVectorLiteral([1, Number.NaN]));
});

test("radical das palavras: flexões do mesmo verbo e plural se encontram", () => {
  assert.equal(stem("crio"), stem("criar"));
  assert.equal(stem("criando"), stem("criar"));
  assert.equal(stem("orcamentos"), stem("orcamento"));
  assert.equal(stem("projetos"), stem("projeto"));
  assert.equal(stem("402"), "402");
  assert.deepEqual(tokenize("Como eu crio um Orçamento?"), [stem("crio"), stem("orcamento")]);
  assert.deepEqual(tokenize("o que é a de para"), []);
});

test("busca por palavras: acha a seção certa, respeita o limite e volta vazia sem palavra em comum", () => {
  const docs = [
    { document: "comercial.md", title: "Comercial e orçamentos", section: "Como criar um orçamento", content: "Em Comercial, abra a oportunidade e crie um orçamento. Preencha os ambientes." },
    { document: "comercial.md", title: "Comercial e orçamentos", section: "Orçamento vindo do Promob", content: "Quando um arquivo do Promob é importado, o sistema cria um orçamento em rascunho." },
    { document: "financeiro.md", title: "Financeiro", section: "Ler boleto", content: "O botão Ler boleto cadastra uma conta a pagar a partir do boleto." },
    { document: "estoque.md", title: "Estoque", section: "Menus", content: "Entrada de Materiais registra o que chegou." },
  ];
  const r = lexicalSearch("Como crio um orçamento?", docs);
  assert.equal(r[0].section, "Como criar um orçamento");
  assert.ok(r.every((x) => x.document === "comercial.md"));
  assert.equal(lexicalSearch("como cadastro um boleto", docs)[0].section, "Ler boleto");
  assert.deepEqual(lexicalSearch("qual a capital da França?", docs), []);
  assert.deepEqual(lexicalSearch("o que é", docs), []);
  assert.equal(lexicalSearch("orçamento boleto materiais comercial", docs, 2).length, 2);
});
