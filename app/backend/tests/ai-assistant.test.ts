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
  parseScope,
  sourcesOf,
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
