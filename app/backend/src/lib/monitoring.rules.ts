/**
 * Monitoramento sem serviço externo: quando o sistema dá erro 500 (ou a tela
 * quebra no navegador), quem administra recebe um aviso no sino. Aqui ficam as
 * regras de agrupamento e de limite, para um erro repetido não virar enxurrada.
 */

export const ALERT_WINDOW_MS = 15 * 60_000;
/** Teto de avisos por hora, somando todos os erros. */
export const MAX_ALERTS_PER_HOUR = 8;

export type AlertStore = { last: Map<string, number>; sent: number[] };
export const newAlertStore = (): AlertStore => ({ last: new Map(), sent: [] });

/** Troca ids por ":id" para o mesmo erro em registros diferentes contar como um só. */
export function routeKey(method: string, url: string): string {
  const path = (url.split("?")[0] || "/")
    .split("/")
    .map((seg) => (/^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f-]{27}|\d+|[A-Za-z0-9_-]{24,})$/.test(seg) ? ":id" : seg))
    .join("/");
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Decide se este erro gera aviso agora: um por chave a cada 15 minutos e no
 * máximo 8 avisos por hora no total. Registra o envio quando devolve true.
 */
export function shouldAlert(store: AlertStore, key: string, now = Date.now()): boolean {
  store.sent = store.sent.filter((t) => now - t < 60 * 60_000);
  const last = store.last.get(key);
  if (last !== undefined && now - last < ALERT_WINDOW_MS) return false;
  if (store.sent.length >= MAX_ALERTS_PER_HOUR) return false;
  store.last.set(key, now);
  store.sent.push(now);
  // não deixa o mapa crescer para sempre
  if (store.last.size > 500) for (const [k, t] of store.last) if (now - t > ALERT_WINDOW_MS) store.last.delete(k);
  return true;
}

export function serverAlertText(e: { key: string; errorId?: string | null; code?: string | null }) {
  return {
    title: "Erro no sistema",
    message: `${e.key} falhou${e.code && e.code !== "INTERNAL_ERROR" ? ` (${e.code})` : ""}${e.errorId ? ` — código ${e.errorId}` : ""}. Se alguém relatar um problema nessa tela, é este erro; o detalhe está no log do servidor.`,
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Mensagem de erro do navegador, sem dado de formulário nem endereço com token. */
export function clientAlertText(e: { message: string; path: string }) {
  const path = (e.path.split("?")[0] || "/").replace(/\/(os|confirmar-visita)\/[^/]+/g, "/$1/:token");
  return { key: `TELA ${routeKey("", path).trim()} ${clip(e.message, 80)}`, title: "Erro em uma tela", message: `Em ${path}: ${clip(e.message.replace(/\s+/g, " "), 200)}` };
}
