import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileText, Loader2, Package, Search, Truck, User, X } from "lucide-react";
import { apiGet } from "@/services/api";
import type { SearchResults } from "@/types";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { data, isFetching } = useQuery({
    queryKey: ["search", query],
    queryFn: () => apiGet<{ data: SearchResults }>("/search", { q: query, limit: 5 }),
    enabled: query.trim().length >= 2,
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const results = useMemo(() => data?.data, [data]);
  const showPanel = open && focused && query.trim().length >= 2;
  const total = results
    ? results.products.length + results.movements.length + results.requisitions.length + results.users.length + results.suppliers.length
    : 0;

  const go = (to: string) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    navigate(to);
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
            setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results?.products.length) go(`/produtos/${results.products[0].id}`);
          }}
          placeholder="Buscar itens..."
          className="h-9 w-full rounded-lg border border-transparent bg-white/10 pl-9 pr-10 text-sm text-white placeholder:text-white/50 transition-colors focus:border-primary/50 focus:bg-white/15 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50 sm:block">
          Ctrl K
        </kbd>
        {isFetching && <Loader2 className="absolute right-8 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-white/50" />}
        {query && (
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              setQuery("");
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-white/50 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border bg-white text-foreground shadow-lg">
          <div className="max-h-[70vh] overflow-y-auto p-1.5">
            {isFetching && (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
              </div>
            )}
            {!isFetching && total === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhum resultado para “{query}”
              </div>
            )}

            {results?.products.length ? (
              <GroupTitle icon={<Package className="h-3.5 w-3.5" />} label="Produtos" />
            ) : null}
            {results?.products.map((p) => (
              <ResultItem key={p.id} onSelect={() => go(`/produtos/${p.id}`)}>
                <Package className="h-4 w-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.code} · Estoque: {p.stock.toLocaleString("pt-BR")} unidades
                  </p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              </ResultItem>
            ))}

            {results?.movements.length ? (
              <GroupTitle icon={<ArrowRight className="h-3.5 w-3.5" />} label="Movimentações" />
            ) : null}
            {results?.movements.map((m) => (
              <ResultItem key={m.id} onSelect={() => go("/movimentacoes")}>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.type === "ENTRY" ? "Entrada" : "Saída"} · {m.quantity} un. · {formatDate(m.date)}
                  </p>
                </div>
              </ResultItem>
            ))}

            {results?.requisitions.length ? (
              <GroupTitle icon={<FileText className="h-3.5 w-3.5" />} label="Requisições" />
            ) : null}
            {results?.requisitions.map((r) => (
              <ResultItem key={r.id} onSelect={() => go(`/requisicoes/${r.id}`)}>
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.number} — {r.requester.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.status}</p>
                </div>
              </ResultItem>
            ))}

            {results?.users.length ? (
              <GroupTitle icon={<User className="h-3.5 w-3.5" />} label="Usuários" />
            ) : null}
            {results?.users.map((u) => (
              <ResultItem key={u.id} onSelect={() => go("/usuarios")}>
                <User className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
              </ResultItem>
            ))}

            {results?.suppliers.length ? (
              <GroupTitle icon={<Truck className="h-3.5 w-3.5" />} label="Fornecedores" />
            ) : null}
            {results?.suppliers.map((s) => (
              <ResultItem key={s.id} onSelect={() => go("/fornecedores")}>
                <Truck className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.cnpj ?? s.contact ?? ""}</p>
                </div>
              </ResultItem>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className={cn("mt-1 flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0")}>
      {icon}
      {label}
    </div>
  );
}

function ResultItem({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent"
    >
      {children}
    </button>
  );
}
