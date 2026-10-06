import { useMemo, useState } from "react";
import { Store } from "lucide-react";

export type InvoiceItem = { id?: string; date: string | null; store: string; description: string | null; installment: string | null; amount: number };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dmy = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

/** Compras de uma fatura de cartão: total por loja e, se quiser, linha por linha. */
export function InvoiceItems({ items }: { items: InvoiceItem[] }) {
  const [view, setView] = useState<"LOJA" | "LINHAS">("LOJA");
  const byStore = useMemo(() => {
    const map = new Map<string, { store: string; count: number; total: number }>();
    for (const it of items) {
      const key = it.store.toUpperCase();
      const cur = map.get(key) ?? { store: it.store, count: 0, total: 0 };
      cur.count += 1;
      cur.total += it.amount;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [items]);
  const total = items.reduce((s, it) => s + it.amount, 0);
  if (!items.length) return null;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium">
          <Store className="h-4 w-4" /> Gastos da fatura ({items.length})
        </h3>
        <div className="flex rounded-md border text-xs">
          <button type="button" className={`px-2.5 py-1 ${view === "LOJA" ? "bg-muted font-medium" : ""}`} onClick={() => setView("LOJA")}>Por loja</button>
          <button type="button" className={`border-l px-2.5 py-1 ${view === "LINHAS" ? "bg-muted font-medium" : ""}`} onClick={() => setView("LINHAS")}>Linha por linha</button>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border text-sm">
        {view === "LOJA"
          ? byStore.map((s) => (
              <div key={s.store} className="flex items-center justify-between gap-3 border-b px-3 py-1.5 last:border-b-0">
                <span className="min-w-0 truncate">
                  {s.store} {s.count > 1 && <span className="text-xs text-muted-foreground">· {s.count} compras</span>}
                </span>
                <span className="shrink-0 tabular-nums">{brl(s.total)}</span>
              </div>
            ))
          : items.map((it, i) => (
              <div key={it.id ?? i} className="flex items-center justify-between gap-3 border-b px-3 py-1.5 last:border-b-0">
                <span className="min-w-0 truncate">
                  <span className="mr-2 text-xs text-muted-foreground tabular-nums">{dmy(it.date)}</span>
                  {it.store} {it.installment && <span className="text-xs text-muted-foreground">· parcela {it.installment}</span>}
                </span>
                <span className="shrink-0 tabular-nums">{brl(it.amount)}</span>
              </div>
            ))}
      </div>
      <p className="mt-1 text-right text-xs text-muted-foreground">Soma das compras: {brl(total)}</p>
    </section>
  );
}
