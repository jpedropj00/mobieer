/**
 * Endereço e modelo do provedor de IA descobertos pela chave: basta AI_API_KEY,
 * e um AI_BASE_URL de outro provedor é corrigido.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiEndpoint } from "../src/config/ai-endpoint";

test("só a chave do Groq já resolve endereço e modelo", () => {
  assert.deepEqual(resolveAiEndpoint("gsk_abc123", "", ""), { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", provider: "Groq", adjusted: false });
  assert.deepEqual(resolveAiEndpoint("gsk_abc123", undefined, undefined).provider, "Groq");
});

test("endereço de outro provedor é trocado pelo da chave, e o modelo antigo não é aproveitado", () => {
  const r = resolveAiEndpoint("gsk_abc123", "https://openrouter.ai/api/v1", "stealth/ox-alpha");
  assert.deepEqual(r, { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", provider: "Groq", adjusted: true });
});

test("endereço certo é respeitado, com o modelo escolhido ou o padrão do provedor", () => {
  assert.deepEqual(resolveAiEndpoint("gsk_abc", "https://api.groq.com/openai/v1/", "qwen/qwen3.8-27b"), { baseUrl: "https://api.groq.com/openai/v1", model: "qwen/qwen3.8-27b", provider: "Groq", adjusted: false });
  assert.equal(resolveAiEndpoint("gsk_abc", "https://api.groq.com/openai/v1", "").model, "openai/gpt-oss-120b");
  assert.equal(resolveAiEndpoint("gsk_abc", "", "qwen/qwen3.8-27b").model, "qwen/qwen3.8-27b"); // sem endereço, o modelo informado vale
});

test("outros provedores e chave de formato desconhecido", () => {
  assert.equal(resolveAiEndpoint("sk-or-v1-xyz", "", "").baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(resolveAiEndpoint("xai-xyz", "", "").baseUrl, "https://api.x.ai/v1");
  assert.equal(resolveAiEndpoint("sk-proj-xyz", "", "").baseUrl, "https://api.openai.com/v1");
  // "sk-" é usado por vários compatíveis: o endereço informado manda
  assert.deepEqual(resolveAiEndpoint("sk-xyz", "https://meu-proxy.exemplo/v1", "modelo-x"), { baseUrl: "https://meu-proxy.exemplo/v1", model: "modelo-x", provider: "meu-proxy.exemplo", adjusted: false });
  assert.deepEqual(resolveAiEndpoint("chave-qualquer", "https://outro.exemplo/v1", "m"), { baseUrl: "https://outro.exemplo/v1", model: "m", provider: "outro.exemplo", adjusted: false });
  assert.equal(resolveAiEndpoint("", "", "").baseUrl, "https://api.openai.com/v1");
});
