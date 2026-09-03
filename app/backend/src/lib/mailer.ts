import { env } from "../config/env";

/**
 * Envio de e-mail com dois adaptadores:
 *  - "console" : imprime o e-mail no log (desenvolvimento / sem provedor).
 *  - "resend"  : envia via API HTTP da Resend (https://resend.com) — sem SDK.
 *
 * Nenhum token/link sensível é retornado na resposta HTTP da API: a entrega
 * acontece apenas por este canal.
 */

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendMail(message: MailMessage): Promise<{ delivered: boolean }> {
  if (env.mail.driver === "resend" && env.mail.resendApiKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.mail.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.mail.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!res.ok) {
      console.error(`[mailer] Resend falhou (${res.status}): ${await res.text()}`);
      return { delivered: false };
    }
    return { delivered: true };
  }

  // Fallback: console
  console.info(
    [
      "",
      "──────────── E-MAIL (modo console) ────────────",
      `De:      ${env.mail.from}`,
      `Para:    ${message.to}`,
      `Assunto: ${message.subject}`,
      "",
      message.text ?? message.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      "───────────────────────────────────────────────",
      "",
    ].join("\n")
  );
  return { delivered: false };
}

export function renderInviteEmail(params: { name: string; companyName: string; link: string }) {
  const { name, companyName, link } = params;
  return {
    subject: `${companyName} — acesso ao portal do cliente`,
    text: `Olá, ${name}.\n\nVocê recebeu acesso ao portal do cliente da ${companyName}.\nDefina sua senha para entrar: ${link}\n\nO link expira em 7 dias.`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#241f1c;line-height:1.6">
        <p>Olá, ${escapeHtml(name)}.</p>
        <p>Você recebeu acesso ao <strong>portal do cliente</strong> da ${escapeHtml(companyName)}.</p>
        <p><a href="${escapeAttr(link)}" style="background:#bd5528;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Definir minha senha</a></p>
        <p style="font-size:13px;color:#8a7f75">Ou copie e cole no navegador:<br>${escapeHtml(link)}</p>
        <p style="font-size:13px;color:#8a7f75">O link expira em 7 dias.</p>
      </div>`,
  };
}

export function renderResetEmail(params: { name: string; companyName: string; link: string }) {
  const { name, companyName, link } = params;
  return {
    subject: `${companyName} — redefinição de senha`,
    text: `Olá, ${name}.\n\nRecebemos um pedido para redefinir a senha do seu acesso ao portal.\nRedefina aqui: ${link}\n\nSe não foi você, ignore este e-mail. O link expira em 1 hora.`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#241f1c;line-height:1.6">
        <p>Olá, ${escapeHtml(name)}.</p>
        <p>Recebemos um pedido para redefinir a senha do seu acesso ao portal da ${escapeHtml(companyName)}.</p>
        <p><a href="${escapeAttr(link)}" style="background:#bd5528;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Redefinir senha</a></p>
        <p style="font-size:13px;color:#8a7f75">Se não foi você, ignore este e-mail. O link expira em 1 hora.</p>
      </div>`,
  };
}

function escapeHtml(v: string) {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(v: string) {
  return escapeHtml(v);
}
