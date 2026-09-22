import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Target } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/use-auth";

type Numbers = {
  goal: number | null;
  sold: number;
  missing: number | null;
  percent: number | null;
  dailyNeeded: number | null;
  projected: number;
  onTrack: boolean | null;
  salesCount: number;
  ticketMedio: number;
  proposals: number;
  conversion: number | null;
  openOpportunities: number;
  forecastLabel: string;
};
type Dashboard = Numbers & { month: string; scope: "seller" | "store"; bySeller: (Numbers & { sellerId: string; name: string })[] };

const brl = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
const mesAtual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" }).slice(0, 7);

/** Metas do mês: meta, vendido, faltante, ritmo e previsão. */
export function CommercialGoals() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [month, setMonth] = useState(mesAtual());
  const [meta, setMeta] = useState("");

  const q = useQuery({
    queryKey: ["goals", month],
    queryFn: () => apiGet<{ data: Dashboard }>("/commercial/goals/dashboard", { month }),
  });

  const salvar = useMutation({
    mutationFn: () => apiPut("/commercial/goals", { month, amount: Number(meta.replace(/\./g, "").replace(",", ".")), userId: null }),
    onSuccess: () => {
      toast.success("Meta da loja salva");
      setMeta("");
      qc.invalidateQueries({ queryKey: ["goals", month] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar a meta")),
  });

  const d = q.data?.data;
  const pct = d?.percent ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <Label htmlFor="g-mes" className="text-xs">Mês</Label>
            <Input id="g-mes" type="month" value={month} onChange={(e) => setMonth(e.target.value || mesAtual())} className="w-[170px]" />
          </div>
          {can("commercial.goals.manage") && (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (meta) salvar.mutate();
              }}
            >
              <div>
                <Label htmlFor="g-valor" className="text-xs">Meta da loja no mês</Label>
                <Input id="g-valor" value={meta} onChange={(e) => setMeta(e.target.value)} placeholder={d?.goal ? String(d.goal) : "0,00"} inputMode="decimal" className="w-[170px]" />
              </div>
              <Button type="submit" size="sm" disabled={salvar.isPending || !meta}>
                {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar meta
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !d ? (
        <p className="text-sm text-destructive">{errorMessage(q.error, "Não foi possível carregar as metas")}</p>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <Target className="h-4 w-4" /> {d.scope === "seller" ? "Sua meta" : "Meta da loja"}
                </span>
                {d.onTrack !== null && (
                  <Badge variant={d.onTrack ? "success" : "warning"}>{d.onTrack ? "Previsão acima da meta" : "Previsão abaixo da meta"}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {d.goal === null ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma meta definida para este mês{can("commercial.goals.manage") ? " — informe o valor acima." : "."} Vendido até agora: <strong>{brl(d.sold)}</strong>.
                </p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between text-sm">
                    <span>
                      <strong className="text-lg tabular-nums">{brl(d.sold)}</strong> <span className="text-muted-foreground">de {brl(d.goal)}</span>
                    </span>
                    <span className="tabular-nums font-medium">{pct.toLocaleString("pt-BR")}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.min(100, pct)} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metrica rotulo="Faltante" valor={brl(d.missing)} />
                <Metrica rotulo="Precisa vender por dia" valor={d.dailyNeeded === null ? "—" : brl(d.dailyNeeded)} />
                <Metrica rotulo="Ticket médio" valor={brl(d.ticketMedio)} dica={`${d.salesCount} venda(s)`} />
                <Metrica rotulo="Conversão" valor={d.conversion === null ? "—" : `${d.conversion.toLocaleString("pt-BR")}%`} dica={`${d.proposals} proposta(s)`} />
              </div>
              <p className="text-xs text-muted-foreground">
                Previsão de fechamento: <strong>{brl(d.projected)}</strong>. {d.forecastLabel}
              </p>
            </CardContent>
          </Card>

          {d.bySeller.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Por consultor</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Consultor</TableHead>
                      <TableHead className="text-right">Meta</TableHead>
                      <TableHead className="text-right">Vendido</TableHead>
                      <TableHead className="text-right">%</TableHead>
                      <TableHead className="text-right">Previsão</TableHead>
                      <TableHead className="text-right">Oportunidades</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.bySeller.map((s) => (
                      <TableRow key={s.sellerId}>
                        <TableCell>{s.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{brl(s.goal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{brl(s.sold)}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.percent === null ? "—" : `${s.percent.toLocaleString("pt-BR")}%`}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{brl(s.projected)}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.openOpportunities}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Metrica({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-lg font-semibold tabular-nums">{valor}</p>
      {dica && <p className="text-[11px] text-muted-foreground">{dica}</p>}
    </div>
  );
}
