/**
 * Diagnóstico ao vivo da conta do WhatsApp na Meta. Só leitura: nenhuma
 * mensagem é enviada. Roda com as credenciais do .env do backend.
 */
import { env } from "../src/config/env";

const mask = (s: string) => (s ? `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} chars)` : "(vazio)");

async function graph(path: string) {
  const url = `https://graph.facebook.com/${env.whatsapp.graphVersion}/${path}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${env.whatsapp.token}` } });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, body };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, body: { error: { message: e instanceof Error ? e.message : String(e) } } };
  }
}

const line = (label: string, value: unknown) => console.log(`  ${label.padEnd(26)} ${value}`);

async function main() {
  console.log("\n=== CONFIGURAÇÃO LOCAL (.env) ===");
  line("WHATSAPP_ENABLED", env.whatsapp.enabled);
  line("WHATSAPP_TOKEN", mask(env.whatsapp.token));
  line("WHATSAPP_PHONE_NUMBER_ID", env.whatsapp.phoneNumberId || "(vazio)");
  line("WHATSAPP_ACCOUNT_ID", env.whatsapp.accountId || "(vazio)");
  line("WHATSAPP_GRAPH_VERSION", env.whatsapp.graphVersion);
  line("WHATSAPP_TEMPLATE_LANG", env.whatsapp.templateLang);
  line("VERIFY_TOKEN", env.whatsapp.webhookVerifyToken ? "definido" : "(vazio)");
  line("APP_SECRET", env.whatsapp.appSecret ? "definido" : "(vazio)");
  line("API_URL", env.apiUrl);
  line("Callback URL do webhook", `${env.apiUrl}/api/integrations/whatsapp/webhook`);

  if (!env.whatsapp.token || !env.whatsapp.phoneNumberId) {
    console.log("\n(!) Sem token/phone id: nada a consultar na Meta.\n");
    return;
  }

  console.log("\n=== 1. TOKEN (/debug_token) ===");
  const dbg = await graph(`debug_token?input_token=${encodeURIComponent(env.whatsapp.token)}&access_token=${encodeURIComponent(env.whatsapp.token)}`);
  if (dbg.ok) {
    const d = (dbg.body as { data?: Record<string, unknown> }).data ?? {};
    line("tipo", d.type);
    line("app", `${d.application} (${d.app_id})`);
    line("válido", d.is_valid);
    line("expira em", d.expires_at === 0 ? "nunca (permanente)" : new Date(Number(d.expires_at) * 1000).toLocaleString("pt-BR"));
    line("escopos", Array.isArray(d.scopes) ? (d.scopes as string[]).join(", ") : "—");
  } else {
    line("erro", JSON.stringify(dbg.body));
  }

  console.log("\n=== 2. NÚMERO CONECTADO ===");
  const num = await graph(`${env.whatsapp.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput`);
  if (num.ok) {
    const b = num.body as Record<string, unknown>;
    line("número", b.display_phone_number);
    line("nome verificado", b.verified_name);
    line("qualidade", b.quality_rating);
    line("verificação", b.code_verification_status);
    line("plataforma", b.platform_type ?? "—");
    line("latência", `${num.ms}ms`);
  } else {
    line("erro", JSON.stringify(num.body));
  }

  console.log("\n=== 3. TEMPLATES ===");
  if (!env.whatsapp.accountId) {
    line("erro", "WHATSAPP_ACCOUNT_ID vazio — não dá para listar");
  } else {
    const tpl = await graph(`${env.whatsapp.accountId}/message_templates?limit=100&fields=name,status,language,category,components`);
    if (tpl.ok) {
      const data = ((tpl.body as { data?: unknown[] }).data ?? []) as {
        name: string; status: string; language: string; category: string;
        components?: { type: string; text?: string }[];
      }[];
      line("total", data.length);
      for (const t of data) {
        const body = t.components?.find((c) => c.type === "BODY")?.text ?? "";
        const vars = [...body.matchAll(/\{\{(\d+)\}\}/g)].length;
        console.log(`    • ${t.name} [${t.language}] ${t.status} · ${t.category} · ${vars} variável(is)`);
      }
      const pt = data.filter((t) => t.status === "APPROVED" && t.language.toLowerCase().startsWith("pt"));
      line("aprovados em pt", pt.length);
    } else {
      line("erro", JSON.stringify(tpl.body));
    }
  }

  console.log("\n=== 4. WEBHOOK ASSINADO NA META ===");
  if (!env.whatsapp.accountId) {
    line("erro", "precisa do WHATSAPP_ACCOUNT_ID");
  } else {
    const sub = await graph(`${env.whatsapp.accountId}/subscribed_apps`);
    if (sub.ok) {
      const data = ((sub.body as { data?: unknown[] }).data ?? []) as { whatsapp_business_api_data?: { name?: string; id?: string } }[];
      if (!data.length) line("assinatura", "NENHUM app assinado — o webhook não vai receber nada");
      for (const a of data) line("app assinado", `${a.whatsapp_business_api_data?.name} (${a.whatsapp_business_api_data?.id})`);
    } else {
      line("erro", JSON.stringify(sub.body));
    }
  }

  console.log("\n=== 5. CALLBACK URL RESPONDE? ===");
  const hookUrl = `${env.apiUrl}/api/integrations/whatsapp/webhook`;
  const challenge = "1234567890";
  for (const [label, token] of [["token correto", env.whatsapp.webhookVerifyToken], ["token errado", "token-invalido"]] as const) {
    if (!token) { line(label, "(sem token configurado)"); continue; }
    try {
      const res = await fetch(`${hookUrl}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${challenge}`);
      const text = (await res.text()).slice(0, 120);
      line(label, `HTTP ${res.status} · ${text === challenge ? "devolveu o challenge ✔" : text}`);
    } catch (e) {
      line(label, `inacessível: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
