import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/states";
import { apiGet } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Reminder = {
  kind: string;
  label: string;
  priority: number;
  sellerId: string | null;
  sellerName: string | null;
  client: string;
  title: string;
  detail: string;
  days: number;
  link: string;
};
type Reminders = {
  total: number;
  scope: "seller" | "store";
  counts: { kind: string; label: string; count: number }[];
  sellers: { id: string; name: string; count: number }[];
  items: Reminder[];
};

const VARIANT: Record<string, "danger" | "warning" | "secondary"> = {
  ACAO_VENCIDA: "danger",
  ORCAMENTO_VENCENDO: "danger",
  ORCAMENTO_SEM_RETORNO: "warning",
  LEAD_SEM_CONTATO: "warning",
  ORCAMENTO_PARADO: "secondary",
  SEM_CONTATO: "secondary",
};

export const remindersQuery = (sellerId?: string) => ({
  queryKey: ["commercial", "reminders", sellerId ?? ""],
  queryFn: () => apiGet<{ data: Reminders }>("/commercial/reminders", sellerId ? { sellerId } : undefined),
});

/** Clientes em aberto que precisam de contato: o que fazer hoje, do mais urgente ao menos. */
export function CommercialReminders() {
  const [seller, setSeller] = useState("all");
  const [kind, setKind] = useState("all");
  const all = useQuery(remindersQuery());

  const d = all.data?.data;
  if (all.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!d) return <p className="text-sm text-destructive">{errorMessage(all.error, "Não foi possível carregar os lembretes")}</p>;
  if (d.total === 0) return <EmptyState title="Nenhum cliente esperando contato" description="Ações em dia, orçamentos respondidos e leads atendidos." />;

  const items = d.items.filter((i) => (seller === "all" || i.sellerId === seller) && (kind === "all" || i.kind === kind));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setKind("all")} className={`rounded-full border px-3 py-1 text-xs ${kind === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
          Todos ({d.total})
        </button>
        {d.counts.map((c) => (
          <button key={c.kind} onClick={() => setKind(c.kind)} className={`rounded-full border px-3 py-1 text-xs ${kind === c.kind ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
            {c.label} ({c.count})
          </button>
        ))}
        {d.scope === "store" && d.sellers.length > 1 && (
          <Select value={seller} onValueChange={setSeller}>
            <SelectTrigger className="ml-auto h-8 w-[200px]" aria-label="Vendedor"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os vendedores</SelectItem>
              {d.sellers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name} ({s.count})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4" /> Clientes em aberto para contatar
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {items.map((r, i) => (
            <Link key={`${r.kind}-${r.link}-${i}`} to={r.link} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{r.client}</span>
                  <Badge variant={VARIANT[r.kind] ?? "secondary"}>{r.label}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {r.title} · {r.detail}
                </p>
              </div>
              {d.scope === "store" && <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{r.sellerName ?? "Sem vendedor"}</span>}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
          {items.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nada neste filtro.</p>}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Entram aqui: ação do funil com data vencida, orçamento enviado há 3 dias sem resposta ou com a validade acabando, rascunho de orçamento parado há 2 dias, lead sem primeiro contato ou com retorno atrasado, e oportunidade sem contato há 7 dias. Cada vendedor também recebe o resumo no sino uma vez por dia.
      </p>
    </div>
  );
}
