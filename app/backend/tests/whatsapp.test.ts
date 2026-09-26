/**
 * Bateria do WhatsApp: normalização de telefone, montagem do payload enviado à
 * Meta, templates e marcadores, webhook (assinatura + extração de mensagens),
 * leitura da resposta do cliente e diagnóstico da conta.
 *
 * Nenhum teste aqui acessa banco ou rede: o `fetch` global é substituído por um
 * stub que guarda a requisição, então dá para conferir exatamente o corpo que
 * sairia para a Graph API sem mandar mensagem para ninguém.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { MessageEvent } from "@prisma/client";
import { env } from "../src/config/env";
import { AUTOMATION_DEFAULTS, MESSAGE_EVENTS, fmtVisit, templateParams } from "../src/lib/automations";
import { sendWhatsAppTemplate, sendWhatsAppText, toWhatsAppNumber } from "../src/lib/whatsapp";
import { whatsappStatus } from "../src/lib/whatsapp-status";
import { extractInboundMessages, validMetaSignature } from "../src/modules/integrations/whatsapp-webhook.routes";
import { parseClientReply } from "../src/modules/assistance/assistance.service";
import { renderTemplate, templateKeys } from "../src/utils/template";

// ---------------------------------------------------------------------------
// Stub de fetch + controle do env
// ---------------------------------------------------------------------------

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

const realFetch = globalThis.fetch;
const wa = env.whatsapp as {
  enabled: boolean;
  token: string;
  phoneNumberId: string;
  accountId: string;
  graphVersion: string;
  templateLang: string;
  appSecret: string;
  webhookVerifyToken: string;
};
const snapshot = { ...wa };

/** Troca o fetch por um stub que responde `responses` na ordem e grava as chamadas. */
function stubFetch(responses: { ok?: boolean; status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const r = responses[Math.min(i++, responses.length - 1)];
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    } as Response;
  }) as typeof fetch;
  return calls;
}

function restore() {
  globalThis.fetch = realFetch;
  Object.assign(wa, snapshot);
}

function configure(over: Partial<typeof snapshot> = {}) {
  Object.assign(wa, {
    enabled: true,
    token: "TOKEN_DE_TESTE",
    phoneNumberId: "1111111111",
    accountId: "2222222222",
    graphVersion: "v21.0",
    templateLang: "pt_BR",
    ...over,
  });
}

// ---------------------------------------------------------------------------
// 1. Normalização de telefone
// ---------------------------------------------------------------------------

test("toWhatsAppNumber normaliza os formatos que a loja digita", () => {
  // celular de Fortaleza, com e sem máscara
  assert.equal(toWhatsAppNumber("(85) 99999-8888"), "5585999998888");
  assert.equal(toWhatsAppNumber("85999998888"), "5585999998888");
  assert.equal(toWhatsAppNumber("+55 85 99999-8888"), "5585999998888");
  assert.equal(toWhatsAppNumber("55 85 99999 8888"), "5585999998888");
  // fixo com DDD (10 dígitos)
  assert.equal(toWhatsAppNumber("8532223333"), "558532223333");
  // já em E.164 sem o +
  assert.equal(toWhatsAppNumber("5585999998888"), "5585999998888");
});

test("toWhatsAppNumber recusa o que não dá para inferir", () => {
  assert.equal(toWhatsAppNumber(null), null);
  assert.equal(toWhatsAppNumber(undefined), null);
  assert.equal(toWhatsAppNumber(""), null);
  assert.equal(toWhatsAppNumber("sem número"), null);
  assert.equal(toWhatsAppNumber("99998888"), null, "8 dígitos: sem DDD não dá para inferir");
  assert.equal(toWhatsAppNumber("999998888"), null, "9 dígitos: sem DDD não dá para inferir");
});

test("toWhatsAppNumber mantém número internacional como veio", () => {
  assert.equal(toWhatsAppNumber("+351 912 345 678"), "351912345678");
});

// ---------------------------------------------------------------------------
// 2. Envio: payload que chega na Meta
// ---------------------------------------------------------------------------

test("sendWhatsAppText monta o payload de texto da Cloud API", async (t) => {
  t.after(restore);
  configure();
  const calls = stubFetch([{ body: { messages: [{ id: "wamid.TESTE" }] } }]);

  const r = await sendWhatsAppText("(85) 99999-8888", "Olá, Maria!");

  assert.deepEqual(r, { delivered: true, id: "wamid.TESTE" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://graph.facebook.com/v21.0/1111111111/messages");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer TOKEN_DE_TESTE");
  assert.deepEqual(calls[0].body, {
    messaging_product: "whatsapp",
    to: "5585999998888",
    type: "text",
    text: { body: "Olá, Maria!", preview_url: false },
  });
});

test("sendWhatsAppText não chama a Meta quando o telefone é inválido", async (t) => {
  t.after(restore);
  configure();
  const calls = stubFetch([{ body: {} }]);

  const r = await sendWhatsAppText("99998888", "oi");

  assert.equal(r.delivered, false);
  assert.equal(r.skipped, true);
  assert.equal(calls.length, 0, "número inválido não pode gerar chamada de rede");
});

test("sem credencial o envio cai no modo log e não vaza para a rede", async (t) => {
  t.after(restore);
  configure({ enabled: false });
  const calls = stubFetch([{ body: {} }]);

  const r = await sendWhatsAppText("85999998888", "mensagem de teste");

  assert.deepEqual(r, { delivered: false, skipped: true });
  assert.equal(calls.length, 0);
});

test("sendWhatsAppText devolve o erro da Meta sem lançar", async (t) => {
  t.after(restore);
  configure();
  stubFetch([{ ok: false, status: 400, body: { error: { message: "(#131030) Recipient phone number not in allowed list" } } }]);

  const r = await sendWhatsAppText("85999998888", "oi");

  assert.equal(r.delivered, false);
  assert.match(r.error ?? "", /131030/);
});

test("sendWhatsAppText sobrevive a erro de rede", async (t) => {
  t.after(restore);
  configure();
  globalThis.fetch = (async () => {
    throw new Error("ECONNRESET");
  }) as typeof fetch;

  const r = await sendWhatsAppText("85999998888", "oi");

  assert.equal(r.delivered, false);
  assert.equal(r.error, "ECONNRESET");
});

test("sendWhatsAppTemplate manda nome, idioma e parâmetros na ordem", async (t) => {
  t.after(restore);
  configure();
  const calls = stubFetch([{ body: { messages: [{ id: "wamid.TPL" }] } }]);

  await sendWhatsAppTemplate("85999998888", "medicao_agendada", ["Maria", "18/09 às 09:00"]);

  assert.deepEqual(calls[0].body, {
    messaging_product: "whatsapp",
    to: "5585999998888",
    type: "template",
    template: {
      name: "medicao_agendada",
      language: { code: "pt_BR" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Maria" },
            { type: "text", text: "18/09 às 09:00" },
          ],
        },
      ],
    },
  });
});

test("sendWhatsAppTemplate sem parâmetros omite components", async (t) => {
  t.after(restore);
  configure();
  const calls = stubFetch([{ body: { messages: [{ id: "x" }] } }]);

  await sendWhatsAppTemplate("85999998888", "boas_vindas");

  const tpl = (calls[0].body as { template: Record<string, unknown> }).template;
  assert.equal("components" in tpl, false);
  assert.deepEqual(tpl.language, { code: "pt_BR" });
});

// ---------------------------------------------------------------------------
// 3. Templates e marcadores
// ---------------------------------------------------------------------------

test("todo evento de automação só usa marcadores que ele declara", () => {
  for (const event of MESSAGE_EVENTS) {
    const def = AUTOMATION_DEFAULTS[event];
    const declared = new Set(def.vars);
    const used = templateKeys(def.body);
    const unknown = used.filter((k) => !declared.has(k));
    assert.deepEqual(unknown, [], `${event}: marcador não declarado ${unknown.join(", ")}`);
  }
});

test("os 11 eventos de mensagem têm texto e rótulo", () => {
  const events = Object.values(MessageEvent);
  assert.equal(MESSAGE_EVENTS.length, events.length);
  for (const event of events) {
    const def = AUTOMATION_DEFAULTS[event as MessageEvent];
    assert.ok(def, `${event} sem configuração padrão`);
    assert.ok(def.label.length > 3, `${event} sem rótulo`);
    assert.ok(def.body.length > 20, `${event} com texto curto demais`);
  }
});

test("o lembrete de véspera explica as duas respostas aceitas", () => {
  const body = AUTOMATION_DEFAULTS.ASSISTANCE_REMINDER.body;
  assert.match(body, /CONFIRMAR/);
  assert.match(body, /REMARCAR/);
  // e as duas respostas realmente são entendidas pelo webhook
  assert.equal(parseClientReply("CONFIRMAR"), "CONFIRM");
  assert.equal(parseClientReply("REMARCAR"), "RESCHEDULE");
});

test("templateParams respeita a ordem em que os marcadores aparecem no texto", () => {
  const body = "Oi {{cliente.primeiroNome}}, a medição do {{projeto.codigo}} é {{medicao.data}}.";
  const values = { "cliente.primeiroNome": "Maria", "projeto.codigo": "364-1", "medicao.data": "18/09" };
  assert.deepEqual(templateParams(body, values), ["Maria", "364-1", "18/09"]);
});

test("templateParams preenche vazio para marcador sem valor (não quebra o envio)", () => {
  assert.deepEqual(templateParams("{{a}} e {{b}}", { a: "1" }), ["1", ""]);
});

test("marcador repetido vira um parâmetro só", () => {
  assert.deepEqual(templateKeys("{{x}} {{x}} {{y}}"), ["x", "y"]);
});

test("renderTemplate trata valor com $& e {{ }} como texto literal", () => {
  const r = renderTemplate("Olá, {{nome}}!", { nome: "$& {{empresa.nome}}" });
  assert.equal(r.text, "Olá, $& {{empresa.nome}}!");
  assert.deepEqual(r.missing, []);
});

test("renderTemplate aponta marcador ausente e vazio", () => {
  const r = renderTemplate("{{a}}|{{b}}|{{c}}", { a: "ok", b: "" });
  assert.equal(r.text, "ok||____");
  assert.deepEqual(r.missing.sort(), ["b", "c"]);
});

test("fmtVisit escreve a data no fuso de Fortaleza", () => {
  // 18/09/2026 12:00 UTC = 09:00 em Fortaleza (UTC-3, sem horário de verão)
  const d = new Date("2026-09-18T12:00:00Z");
  assert.equal(fmtVisit(d), "18/09 (sexta) às 09:00");
  assert.equal(fmtVisit(d, "MANHA"), "18/09 (sexta) pela manhã");
  assert.equal(fmtVisit(d, "TARDE"), "18/09 (sexta) à tarde");
});

// ---------------------------------------------------------------------------
// 4. Webhook: assinatura da Meta
// ---------------------------------------------------------------------------

const sign = (body: Buffer, secret: string) => `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

test("assinatura válida passa", () => {
  const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
  assert.equal(validMetaSignature(body, sign(body, "segredo"), "segredo"), true);
});

test("assinatura de outro segredo é rejeitada", () => {
  const body = Buffer.from("{}");
  assert.equal(validMetaSignature(body, sign(body, "outro"), "segredo"), false);
});

test("corpo adulterado invalida a assinatura", () => {
  const original = Buffer.from(JSON.stringify({ valor: 1 }));
  const header = sign(original, "segredo");
  const adulterado = Buffer.from(JSON.stringify({ valor: 2 }));
  assert.equal(validMetaSignature(adulterado, header, "segredo"), false);
});

test("sem cabeçalho, sem prefixo sha256= ou sem corpo, a assinatura falha", () => {
  const body = Buffer.from("{}");
  assert.equal(validMetaSignature(body, undefined, "segredo"), false);
  assert.equal(validMetaSignature(body, "abc123", "segredo"), false);
  assert.equal(validMetaSignature(undefined, sign(body, "segredo"), "segredo"), false);
});

test("assinatura com tamanho diferente não quebra o timingSafeEqual", () => {
  const body = Buffer.from("{}");
  assert.doesNotThrow(() => validMetaSignature(body, "sha256=abcd", "segredo"));
  assert.equal(validMetaSignature(body, "sha256=abcd", "segredo"), false);
});

test("sem WHATSAPP_APP_SECRET a validação é permissiva (e o diagnóstico avisa)", () => {
  const body = Buffer.from("{}");
  assert.equal(validMetaSignature(body, undefined, ""), true);
});

// ---------------------------------------------------------------------------
// 5. Webhook: extração das mensagens recebidas
// ---------------------------------------------------------------------------

const inbound = (messages: unknown[]) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages } }] }],
});

test("extrai mensagem de texto", () => {
  const got = extractInboundMessages(inbound([{ from: "5585999998888", type: "text", text: { body: "CONFIRMAR" } }]));
  assert.deepEqual(got, [{ from: "5585999998888", text: "CONFIRMAR" }]);
});

test("extrai resposta de botão (payload tem prioridade sobre o rótulo)", () => {
  const got = extractInboundMessages(
    inbound([{ from: "5585999998888", type: "button", button: { payload: "CONFIRMAR", text: "Sim, confirmo" } }])
  );
  assert.deepEqual(got, [{ from: "5585999998888", text: "CONFIRMAR" }]);
});

test("extrai resposta de lista interativa", () => {
  const got = extractInboundMessages(
    inbound([{ from: "5585999998888", type: "interactive", interactive: { button_reply: { id: "REMARCAR", title: "Quero remarcar" } } }])
  );
  assert.deepEqual(got, [{ from: "5585999998888", text: "REMARCAR" }]);
});

test("ignora status de entrega e mensagens sem texto", () => {
  assert.deepEqual(extractInboundMessages(inbound([{ from: "5585999998888", type: "image", image: { id: "x" } }])), []);
  assert.deepEqual(
    extractInboundMessages({ entry: [{ changes: [{ value: { statuses: [{ status: "delivered" }] } }] }] }),
    []
  );
});

test("payload malformado não derruba a extração", () => {
  assert.deepEqual(extractInboundMessages(undefined), []);
  assert.deepEqual(extractInboundMessages({}), []);
  assert.deepEqual(extractInboundMessages({ entry: [] }), []);
  assert.deepEqual(extractInboundMessages({ entry: [{}] }), []);
  assert.deepEqual(extractInboundMessages({ entry: [{ changes: [{}] }] }), []);
  assert.deepEqual(extractInboundMessages("texto solto"), []);
});

test("lê várias mensagens de várias entradas", () => {
  const got = extractInboundMessages({
    entry: [
      { changes: [{ value: { messages: [{ from: "5585111111111", type: "text", text: { body: "sim" } }] } }] },
      {
        changes: [
          {
            value: {
              messages: [
                { from: "5585222222222", type: "text", text: { body: "remarcar" } },
                { from: "5585333333333", type: "text", text: { body: "ok" } },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.deepEqual(got.map((m) => m.from), ["5585111111111", "5585222222222", "5585333333333"]);
});

// ---------------------------------------------------------------------------
// 6. Leitura da resposta do cliente
// ---------------------------------------------------------------------------

test("confirmações que o cliente costuma escrever", () => {
  for (const t of ["sim", "SIM", "ok", "Confirmo", "confirmado", "CONFIRMAR", "pode vir", "combinado", "beleza", "certo", "confirmo sim", "👍"]) {
    assert.equal(parseClientReply(t), "CONFIRM", `"${t}" deveria confirmar`);
  }
});

test("pedidos de remarcação, inclusive sem acento", () => {
  for (const t of ["remarcar", "REMARCAR", "reagendar", "quero outra data", "não posso", "nao posso", "não vou poder", "desmarcar"]) {
    assert.equal(parseClientReply(t), "RESCHEDULE", `"${t}" deveria remarcar`);
  }
});

test("remarcar vence confirmar quando os dois aparecem", () => {
  assert.equal(parseClientReply("confirmo que não posso, quero remarcar"), "RESCHEDULE");
});

test("texto ambíguo não muda o chamado sozinho", () => {
  for (const t of ["", null, undefined, "bom dia", "obrigado", "qual o endereço?", "?"]) {
    assert.equal(parseClientReply(t), null, `"${t}" não deveria decidir nada`);
  }
});

// ---------------------------------------------------------------------------
// 7. Diagnóstico da conta (tela de Configurações → Mensagens)
// ---------------------------------------------------------------------------

test("sem credencial: diagnóstico avisa que tudo fica só no log", async (t) => {
  t.after(restore);
  configure({ enabled: false, token: "", phoneNumberId: "" });
  const calls = stubFetch([{ body: {} }]);

  const s = await whatsappStatus();

  assert.equal(s.configured, false);
  assert.equal(s.number, null);
  assert.equal(calls.length, 0, "não pode consultar a Meta sem credencial");
  assert.match(s.warnings.join(" "), /não configurado/i);
  assert.match(s.webhook.url, /\/api\/integrations\/whatsapp\/webhook$/);
});

/** Resposta de /debug_token para um token permanente de System User. */
const permanentToken = { body: { data: { is_valid: true, expires_at: 0, type: "USER" } } };

test("número de teste da Meta vira aviso explícito", async (t) => {
  t.after(restore);
  configure({ appSecret: "s", webhookVerifyToken: "v" });
  stubFetch([
    permanentToken,
    { body: { display_phone_number: "+1 555 013 3700", verified_name: "Test Number", code_verification_status: "VERIFIED", quality_rating: "GREEN" } },
    { body: { data: [{ name: "hello_world", language: "en_US", status: "APPROVED", category: "UTILITY" }] } },
  ]);

  const s = await whatsappStatus();

  assert.equal(s.configured, true);
  assert.equal(s.number?.isTestNumber, true);
  assert.equal(s.number?.verified, true);
  assert.match(s.warnings.join(" "), /número de teste/i);
  assert.match(s.warnings.join(" "), /português/i, "template só em inglês precisa avisar");
});

test("número da loja com template pt_BR aprovado: sem avisos", async (t) => {
  t.after(restore);
  configure({ appSecret: "s", webhookVerifyToken: "v" });
  stubFetch([
    permanentToken,
    { body: { display_phone_number: "+55 85 99999-8888", verified_name: "Mobieer", code_verification_status: "VERIFIED", quality_rating: "GREEN" } },
    { body: { data: [{ name: "medicao_agendada", language: "pt_BR", status: "APPROVED", category: "UTILITY" }] } },
  ]);

  const s = await whatsappStatus();

  assert.equal(s.number?.isTestNumber, false);
  assert.equal(s.templates.length, 1);
  assert.deepEqual(s.warnings, []);
  assert.deepEqual(s.token, { valid: true, expiresAt: null, expired: false, daysLeft: null }, "token permanente não gera alarme");
});

test("erro da Meta ao ler o número não quebra a tela", async (t) => {
  t.after(restore);
  configure();
  stubFetch([{ ok: false, status: 401, body: { error: { message: "Error validating access token: Session has expired" } } }]);

  const s = await whatsappStatus();

  assert.equal(s.configured, true);
  assert.equal(s.number, null);
  assert.match(s.error ?? "", /access token/i);
});

test("sem WHATSAPP_ACCOUNT_ID o diagnóstico pede o id da conta", async (t) => {
  t.after(restore);
  configure({ accountId: "", appSecret: "s", webhookVerifyToken: "v" });
  const calls = stubFetch([
    permanentToken,
    { body: { display_phone_number: "+55 85 99999-8888", verified_name: "Mobieer", code_verification_status: "VERIFIED" } },
  ]);

  const s = await whatsappStatus();

  assert.equal(calls.length, 2, "sem accountId consulta só token e número, nunca os templates");
  assert.match(s.warnings.join(" "), /WHATSAPP_ACCOUNT_ID/);
});

test("webhook sem token de verificação e sem app secret gera os dois avisos", async (t) => {
  t.after(restore);
  configure({ accountId: "", webhookVerifyToken: "", appSecret: "" });
  stubFetch([permanentToken, { body: { display_phone_number: "+55 85 99999-8888", verified_name: "Mobieer" } }]);

  const s = await whatsappStatus();

  assert.equal(s.webhook.verifyTokenSet, false);
  assert.equal(s.webhook.appSecretSet, false);
  assert.match(s.warnings.join(" "), /WHATSAPP_VERIFY_TOKEN/);
  assert.match(s.warnings.join(" "), /WHATSAPP_APP_SECRET/);
});

test("o diagnóstico nunca devolve o token da Meta", async (t) => {
  t.after(restore);
  configure({ token: "SEGREDO_NAO_PODE_VAZAR", appSecret: "s", webhookVerifyToken: "v" });
  stubFetch([
    permanentToken,
    { body: { display_phone_number: "+55 85 99999-8888", verified_name: "Mobieer" } },
    { body: { data: [{ name: "x", language: "pt_BR", status: "APPROVED", category: "UTILITY" }] } },
  ]);

  const s = await whatsappStatus();

  assert.equal(JSON.stringify(s).includes("SEGREDO_NAO_PODE_VAZAR"), false);
});

// ---------------------------------------------------------------------------
// 8. Validade do token (a falha real que derrubou os envios)
// ---------------------------------------------------------------------------

test("token expirado é apontado como a causa, mesmo com a Meta recusando tudo", async (t) => {
  t.after(restore);
  configure({ appSecret: "s", webhookVerifyToken: "v" });
  const ontem = Math.floor(Date.now() / 1000) - 3600;
  stubFetch([
    { body: { data: { is_valid: false, expires_at: ontem } } },
    { ok: false, status: 401, body: { error: { message: "Error validating access token: Session has expired", code: 190 } } },
  ]);

  const s = await whatsappStatus();

  assert.equal(s.token.expired, true);
  assert.equal(s.token.valid, false);
  assert.equal(s.token.daysLeft, 0);
  assert.match(s.warnings.join(" "), /expirou/i);
  assert.match(s.warnings.join(" "), /System User/i, "precisa dizer como resolver de vez");
  assert.match(s.error ?? "", /access token/i);
});

test("token temporário perto de vencer avisa antes de parar de enviar", async (t) => {
  t.after(restore);
  configure({ accountId: "", appSecret: "s", webhookVerifyToken: "v" });
  const em2dias = Math.floor(Date.now() / 1000) + 2 * 86400;
  stubFetch([
    { body: { data: { is_valid: true, expires_at: em2dias } } },
    { body: { display_phone_number: "+55 85 99999-8888", verified_name: "Mobieer" } },
  ]);

  const s = await whatsappStatus();

  assert.equal(s.token.expired, false);
  assert.equal(s.token.daysLeft, 2);
  assert.match(s.warnings.join(" "), /expira em/i);
});

test("token revogado (sem data de expiração) também avisa", async (t) => {
  t.after(restore);
  configure({ accountId: "", appSecret: "s", webhookVerifyToken: "v" });
  stubFetch([
    { body: { data: { is_valid: false, expires_at: 0 } } },
    { body: { display_phone_number: "+55 85 99999-8888", verified_name: "Mobieer" } },
  ]);

  const s = await whatsappStatus();

  assert.equal(s.token.valid, false);
  assert.equal(s.token.expired, false, "revogado é diferente de vencido");
  assert.match(s.warnings.join(" "), /revogado/i);
});

test("token vencido derruba o próprio debug_token — e mesmo assim o aviso aparece", async (t) => {
  // Caso real: o debug_token se autentica com o token que está sendo conferido.
  // Vencido o token, as DUAS chamadas falham com 190, e antes disso a tela
  // dizia "token válido, nenhum aviso" com nada sendo entregue.
  t.after(restore);
  configure({ appSecret: "s", webhookVerifyToken: "v" });
  const recusa = {
    ok: false,
    status: 401,
    body: { error: { message: "Error validating access token: Session has expired on Thursday, 17-Sep-26 19:00:00 PDT.", code: 190, type: "OAuthException" } },
  };
  stubFetch([recusa, recusa]);

  const s = await whatsappStatus();

  assert.equal(s.token.valid, false, "não pode dizer que o token está bom");
  assert.equal(s.token.expired, true);
  assert.equal(s.token.daysLeft, 0);
  assert.equal(s.warnings.length > 0, true, "a tela precisa avisar");
  assert.match(s.warnings.join(" "), /System User/i, "precisa dizer como resolver");
});

test("recusa da Meta sem código, só com a mensagem, também é reconhecida", async (t) => {
  t.after(restore);
  configure({ appSecret: "s", webhookVerifyToken: "v" });
  const recusa = { ok: false, status: 401, body: { error: { message: "Error validating access token: Session has expired" } } };
  stubFetch([recusa, recusa]);

  const s = await whatsappStatus();

  assert.equal(s.token.expired, true);
  assert.match(s.warnings.join(" "), /token/i);
});

test("falha ao consultar o número não engole os avisos de webhook", async (t) => {
  // O retorno antecipado pulava as checagens de WHATSAPP_VERIFY_TOKEN e
  // WHATSAPP_APP_SECRET: quem estava com a Meta fora do ar não via nem isso.
  t.after(restore);
  configure({ accountId: "", webhookVerifyToken: "", appSecret: "" });
  stubFetch([permanentToken, { ok: false, status: 500, body: { error: { message: "Meta indisponível" } } }]);

  const s = await whatsappStatus();

  assert.equal(s.number, null);
  assert.match(s.warnings.join(" "), /WHATSAPP_VERIFY_TOKEN/);
  assert.match(s.warnings.join(" "), /WHATSAPP_APP_SECRET/);
  assert.match(s.error ?? "", /Meta indisponível/);
});

test("os avisos de webhook não saem repetidos quando tudo responde", async (t) => {
  t.after(restore);
  configure({ accountId: "", webhookVerifyToken: "", appSecret: "" });
  stubFetch([permanentToken, { body: { display_phone_number: "+55 85 99999-8888", verified_name: "Mobieer" } }]);

  const s = await whatsappStatus();

  assert.equal(s.warnings.filter((w) => /WHATSAPP_APP_SECRET/.test(w)).length, 1);
  assert.equal(s.warnings.filter((w) => /WHATSAPP_VERIFY_TOKEN/.test(w)).length, 1);
});

test("quando a Meta não informa a validade, a tela não inventa alarme", async (t) => {
  t.after(restore);
  configure({ accountId: "", appSecret: "s", webhookVerifyToken: "v" });
  stubFetch([
    { ok: false, status: 400, body: { error: { message: "sem permissão para debug_token" } } },
    { body: { display_phone_number: "+55 85 99999-8888", verified_name: "Mobieer" } },
  ]);

  const s = await whatsappStatus();

  assert.deepEqual(s.token, { valid: true, expiresAt: null, expired: false, daysLeft: null });
  assert.equal(s.warnings.some((w) => /expir|revogad/i.test(w)), false, "sem informação não se inventa alarme de token");
});
