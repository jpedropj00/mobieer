/**
 * Webhook do WhatsApp por HTTP de verdade: sobe o app Express numa porta
 * efêmera e bate nele com fetch, do jeito que a Meta faz.
 *
 * Cobre o que o teste de unidade não alcança: o corpo cru preservado para a
 * assinatura, o errorHandler traduzindo ForbiddenError/UnauthorizedError e a
 * rota respondendo 200 rápido mesmo sem nada a fazer.
 *
 * Não encosta no banco: os payloads usados não casam com nenhum chamado, então
 * o handler sai antes de qualquer consulta.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import test, { after, before } from "node:test";
import { createApp } from "../src/app";
import { env } from "../src/config/env";

const wa = env.whatsapp as { appSecret: string; webhookVerifyToken: string };
const snapshot = { ...wa };

let server: http.Server;
let base: string;

before(async () => {
  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  Object.assign(wa, snapshot);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const hook = () => `${base}/api/integrations/whatsapp/webhook`;
const sign = (raw: string, secret: string) => `sha256=${crypto.createHmac("sha256", secret).update(Buffer.from(raw)).digest("hex")}`;

// ---------------------------------------------------------------------------
// GET: verificação do webhook pela Meta
// ---------------------------------------------------------------------------

test("GET devolve o hub.challenge quando o token confere", async () => {
  wa.webhookVerifyToken = "meu-token-de-verificacao";
  const res = await fetch(`${hook()}?hub.mode=subscribe&hub.verify_token=meu-token-de-verificacao&hub.challenge=987654321`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "987654321");
});

test("GET com token errado é recusado com 403", async () => {
  wa.webhookVerifyToken = "meu-token-de-verificacao";
  const res = await fetch(`${hook()}?hub.mode=subscribe&hub.verify_token=chutado&hub.challenge=123`);
  assert.equal(res.status, 403);
  const body = (await res.json()) as { success: boolean; message: string };
  assert.equal(body.success, false);
  assert.match(body.message, /verifica/i);
});

test("GET sem hub.mode=subscribe é recusado", async () => {
  wa.webhookVerifyToken = "meu-token-de-verificacao";
  const res = await fetch(`${hook()}?hub.verify_token=meu-token-de-verificacao&hub.challenge=123`);
  assert.equal(res.status, 403);
});

test("GET é recusado quando a loja não configurou token nenhum", async () => {
  wa.webhookVerifyToken = "";
  const res = await fetch(`${hook()}?hub.mode=subscribe&hub.verify_token=&hub.challenge=123`);
  assert.equal(res.status, 403, "token vazio não pode validar o webhook");
});

// ---------------------------------------------------------------------------
// POST: assinatura e resposta
// ---------------------------------------------------------------------------

const payload = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [{ field: "messages", value: { messaging_product: "whatsapp", statuses: [{ id: "wamid.X", status: "delivered" }] } }],
    },
  ],
});

async function post(raw: string, headers: Record<string, string> = {}) {
  return fetch(hook(), { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: raw });
}

test("POST com assinatura correta é aceito", async () => {
  wa.appSecret = "segredo-do-app";
  const res = await post(payload, { "x-hub-signature-256": sign(payload, "segredo-do-app") });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, handled: [] });
});

test("POST com assinatura de outro segredo é recusado com 401", async () => {
  wa.appSecret = "segredo-do-app";
  const res = await post(payload, { "x-hub-signature-256": sign(payload, "segredo-errado") });
  assert.equal(res.status, 401);
});

test("POST sem cabeçalho de assinatura é recusado quando há app secret", async () => {
  wa.appSecret = "segredo-do-app";
  const res = await post(payload);
  assert.equal(res.status, 401);
});

test("corpo alterado depois de assinado é recusado (o rawBody é o original)", async () => {
  wa.appSecret = "segredo-do-app";
  const header = sign(payload, "segredo-do-app");
  const adulterado = payload.replace("delivered", "read");
  const res = await post(adulterado, { "x-hub-signature-256": header });
  assert.equal(res.status, 401);
});

test("sem app secret configurado o POST passa (e o diagnóstico avisa do risco)", async () => {
  wa.appSecret = "";
  const res = await post(payload);
  assert.equal(res.status, 200);
});

test("payload de status de entrega não gera ação", async () => {
  wa.appSecret = "";
  const res = await post(payload);
  const body = (await res.json()) as { handled: unknown[] };
  assert.deepEqual(body.handled, []);
});

test("mensagem sem intenção clara não gera ação nem consulta", async () => {
  wa.appSecret = "";
  const raw = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ from: "5585999998888", type: "text", text: { body: "bom dia" } }] } }] }],
  });
  const res = await post(raw);
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { handled: unknown[] }).handled, []);
});

test("JSON quebrado responde 400 e não 500", async () => {
  wa.appSecret = "";
  const res = await post("{isso não é json");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code: string };
  assert.equal(body.code, "INVALID_JSON");
});
