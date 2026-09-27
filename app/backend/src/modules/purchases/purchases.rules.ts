/**
 * §30 — Regras puras de compras: transições de status, comparação de cotações
 * e conferência do recebimento. Sem banco, para ficarem testáveis.
 */
import type { PurchaseOrderStatus, PurchaseRequestStatus } from "@prisma/client";

export type Resultado<T> = { ok: true; status: T } | { ok: false; motivo: string };

// ============================================================
// Solicitação
// ============================================================

export type RequestAction = "APPROVE" | "REJECT" | "CANCEL" | "ORDER";

export const REQUEST_STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  REQUESTED: "Aguardando aprovação",
  APPROVED: "Aprovada",
  REJECTED: "Recusada",
  ORDERED: "Pedido emitido",
  CANCELLED: "Cancelada",
};

export function nextRequestStatus(atual: PurchaseRequestStatus, acao: RequestAction): Resultado<PurchaseRequestStatus> {
  switch (acao) {
    case "APPROVE":
      return atual === "REQUESTED" ? { ok: true, status: "APPROVED" } : { ok: false, motivo: `Só dá para aprovar solicitação aguardando aprovação (está "${REQUEST_STATUS_LABEL[atual]}")` };
    case "REJECT":
      return atual === "REQUESTED" ? { ok: true, status: "REJECTED" } : { ok: false, motivo: `Só dá para recusar solicitação aguardando aprovação (está "${REQUEST_STATUS_LABEL[atual]}")` };
    case "ORDER":
      // mais de um pedido pode sair da mesma solicitação (fornecedores diferentes)
      return atual === "APPROVED" || atual === "ORDERED"
        ? { ok: true, status: "ORDERED" }
        : { ok: false, motivo: "A solicitação precisa estar aprovada para virar pedido" };
    case "CANCEL":
      return atual === "REQUESTED" || atual === "APPROVED"
        ? { ok: true, status: "CANCELLED" }
        : { ok: false, motivo: `Solicitação "${REQUEST_STATUS_LABEL[atual]}" não pode ser cancelada` };
  }
}

/** Cotação só entra enquanto a solicitação está aprovada (ou já com pedido parcial). */
export const aceitaCotacao = (s: PurchaseRequestStatus) => s === "APPROVED" || s === "ORDERED";

// ============================================================
// Pedido
// ============================================================

export type OrderAction = "SEND" | "CANCEL";

export const ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Rascunho",
  SENT: "Enviado ao fornecedor",
  PARTIALLY_RECEIVED: "Recebido parcialmente",
  RECEIVED: "Recebido",
  CANCELLED: "Cancelado",
};

export function nextOrderStatus(atual: PurchaseOrderStatus, acao: OrderAction, jaRecebeuAlgo: boolean): Resultado<PurchaseOrderStatus> {
  if (acao === "SEND") {
    return atual === "DRAFT" ? { ok: true, status: "SENT" } : { ok: false, motivo: `Pedido "${ORDER_STATUS_LABEL[atual]}" não pode ser enviado` };
  }
  // cancelar depois de entrar material deixaria estoque sem pedido de origem
  if (jaRecebeuAlgo) return { ok: false, motivo: "Pedido com material já recebido não pode ser cancelado" };
  return atual === "DRAFT" || atual === "SENT"
    ? { ok: true, status: "CANCELLED" }
    : { ok: false, motivo: `Pedido "${ORDER_STATUS_LABEL[atual]}" não pode ser cancelado` };
}

export const aceitaRecebimento = (s: PurchaseOrderStatus) => s === "SENT" || s === "PARTIALLY_RECEIVED";

/** Status do pedido a partir do que já foi recebido de cada item. */
export function statusAposRecebimento(itens: { quantity: number; receivedQty: number }[]): PurchaseOrderStatus {
  const recebeuTudo = itens.every((i) => i.receivedQty >= i.quantity);
  if (recebeuTudo) return "RECEIVED";
  return itens.some((i) => i.receivedQty > 0) ? "PARTIALLY_RECEIVED" : "SENT";
}

/**
 * Confere as linhas de um recebimento contra o pedido. Recusa item que não é do
 * pedido, quantidade não positiva, linha repetida e recebimento acima do saldo —
 * dizendo qual item e quanto falta, não só "inválido".
 */
export function conferirRecebimento(
  itens: { id: string; description: string; quantity: number; receivedQty: number }[],
  linhas: { orderItemId: string; quantity: number }[]
): { ok: true } | { ok: false; motivo: string } {
  if (!linhas.length) return { ok: false, motivo: "Informe ao menos um item recebido" };
  const porId = new Map(itens.map((i) => [i.id, i]));
  const vistos = new Set<string>();
  for (const l of linhas) {
    const item = porId.get(l.orderItemId);
    if (!item) return { ok: false, motivo: "Item não pertence a este pedido" };
    if (vistos.has(l.orderItemId)) return { ok: false, motivo: `"${item.description}" aparece duas vezes no recebimento` };
    vistos.add(l.orderItemId);
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) return { ok: false, motivo: `Quantidade inválida para "${item.description}"` };
    const saldo = item.quantity - item.receivedQty;
    if (l.quantity > saldo) {
      return { ok: false, motivo: `"${item.description}": pedido ${item.quantity}, já recebido ${item.receivedQty}, saldo ${saldo} — não dá para receber ${l.quantity}` };
    }
  }
  return { ok: true };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function totalPedido(itens: { quantity: number; unitPrice: number }[], frete: number) {
  return round2(itens.reduce((s, i) => s + i.quantity * i.unitPrice, 0) + frete);
}

// ============================================================
// Comparação de cotações
// ============================================================

export type CotacaoParaComparar = {
  id: string;
  supplierName: string;
  freight: number;
  deliveryDays: number | null;
  prices: { requestItemId: string; unitPrice: number }[];
};

export type Comparacao = {
  quotes: {
    id: string;
    supplierName: string;
    subtotal: number;
    freight: number;
    total: number;
    deliveryDays: number | null;
    /** Cotou todos os itens da solicitação. */
    complete: boolean;
    missingItems: string[];
  }[];
  items: {
    requestItemId: string;
    description: string;
    quantity: number;
    bestQuoteId: string | null;
    bestUnitPrice: number | null;
    prices: { quoteId: string; unitPrice: number | null }[];
  }[];
  /** Menor total entre as cotações completas; incompleta não concorre ao "melhor". */
  cheapestCompleteQuoteId: string | null;
  fastestCompleteQuoteId: string | null;
};

export function compararCotacoes(
  itens: { id: string; description: string; quantity: number }[],
  cotacoes: CotacaoParaComparar[]
): Comparacao {
  const quotes = cotacoes.map((q) => {
    const precos = new Map(q.prices.map((p) => [p.requestItemId, p.unitPrice]));
    const faltando = itens.filter((i) => !precos.has(i.id)).map((i) => i.description);
    const subtotal = round2(itens.reduce((s, i) => s + (precos.get(i.id) ?? 0) * i.quantity, 0));
    return {
      id: q.id,
      supplierName: q.supplierName,
      subtotal,
      freight: round2(q.freight),
      total: round2(subtotal + q.freight),
      deliveryDays: q.deliveryDays,
      complete: faltando.length === 0,
      missingItems: faltando,
    };
  });

  const items = itens.map((i) => {
    const prices = cotacoes.map((q) => ({ quoteId: q.id, unitPrice: q.prices.find((p) => p.requestItemId === i.id)?.unitPrice ?? null }));
    const cotados = prices.filter((p): p is { quoteId: string; unitPrice: number } => p.unitPrice != null);
    const melhor = cotados.length ? cotados.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a)) : null;
    return {
      requestItemId: i.id,
      description: i.description,
      quantity: i.quantity,
      bestQuoteId: melhor?.quoteId ?? null,
      bestUnitPrice: melhor?.unitPrice ?? null,
      prices,
    };
  });

  const completas = quotes.filter((q) => q.complete);
  const cheapest = completas.length ? completas.reduce((a, b) => (b.total < a.total ? b : a)) : null;
  const comPrazo = completas.filter((q) => q.deliveryDays != null);
  const fastest = comPrazo.length ? comPrazo.reduce((a, b) => (b.deliveryDays! < a.deliveryDays! ? b : a)) : null;

  return { quotes, items, cheapestCompleteQuoteId: cheapest?.id ?? null, fastestCompleteQuoteId: fastest?.id ?? null };
}

/**
 * Quantidade sugerida para repor um produto abaixo do mínimo: completa até o
 * estoque ideal (maxStock); sem ideal cadastrado, até o dobro do mínimo.
 * Desconta o que já está a caminho em pedidos abertos.
 */
export function quantidadeReposicao(p: { stock: number; minStock: number; maxStock: number | null }, aCaminho = 0) {
  const alvo = p.maxStock && p.maxStock > p.minStock ? p.maxStock : p.minStock * 2;
  return Math.max(0, alvo - p.stock - aCaminho);
}
