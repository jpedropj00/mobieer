import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Loader2, Target } from "lucide-react";
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

type Suggestion = {
  month: string;
  suggestion:
    | { ok: false; reason: string }
    | {
        ok: true;
        fixedCosts: number;
        marginPercent: number;
        profitPercent: number;
        breakEven: number;
        recommended: number;
        stretch: number;
        expectedProfit: number;
        avgTicket: number | null;
        contracts: { breakEven: number | null; recommended: number | null; stretch: number | null };
        bySeller: { id: string; name: string; sharePercent: number; suggested: number }[];
        sellersBasis: "HISTORY" | "EQUAL";
      };
  fixed: { source: "FIXOS" | "HISTORICO"; total: number; count: number; items: { description: string; category: string; amount: number }[] };
  margin: { percent: number; source: "CONTRATOS" | "PRECIFICACAO"; sample: number; markup: number; commissionPercent: number };
  ticket: { value: number | null; sample: number };
};

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

      {can("commercial.goals.manage") && <GoalSuggestion month={month} />}

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

/** Meta sugerida: quanto a loja precisa vender para pagar as despesas fixas e ainda sobrar o lucro desejado. */
function GoalSuggestion({ month }: { month: string }) {
  const qc = useQueryClient();
  const [profit, setProfit] = useState("20");
  const [open, setOpen] = useState(false);
  const pct = Math.min(300, Math.max(0, Number(profit) || 0));

  const q = useQuery({
    queryKey: ["goals", "suggestion", month, pct],
    queryFn: () => apiGet<{ data: Suggestion }>("/commercial/goals/suggestion", { month, profit: pct }),
    placeholderData: (prev) => prev,
  });
  const aplicar = useMutation({
    mutationFn: async (v: { amount: number; sellers?: { id: string; suggested: number }[] }) => {
      await apiPut("/commercial/goals", { month, amount: v.amount, userId: null });
      for (const s of v.sellers ?? []) await apiPut("/commercial/goals", { month, amount: s.suggested, userId: s.id });
    },
    onSuccess: (_r, v) => {
      toast.success(v.sellers?.length ? "Meta da loja e dos consultores salvas" : "Meta da loja salva");
      qc.invalidateQueries({ queryKey: ["goals", month] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar a meta")),
  });

  const d = q.data?.data;
  if (!d) return null;
  const s = d.suggestion;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4" /> Meta sugerida pelas despesas fixas
          </span>
          <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <Label htmlFor="g-lucro" className="text-xs">Lucro desejado sobre as fixas</Label>
            <Input id="g-lucro" value={profit} onChange={(e) => setProfit(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className="h-8 w-16 text-right" />%
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!s.ok ? (
          <p className="text-sm text-muted-foreground">{s.reason}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Nivel rotulo="Mínimo (ponto de equilíbrio)" valor={s.breakEven} contratos={s.contracts.breakEven} dica="Paga as despesas fixas, sem lucro" onUse={() => aplicar.mutate({ amount: s.breakEven })} busy={aplicar.isPending} />
              <Nivel destaque rotulo="Recomendada" valor={s.recommended} contratos={s.contracts.recommended} dica={`Paga as fixas e sobra ${brl(s.expectedProfit)}`} onUse={() => aplicar.mutate({ amount: s.recommended })} busy={aplicar.isPending} />
              <Nivel rotulo="Desafio" valor={s.stretch} contratos={s.contracts.stretch} dica="25% acima da recomendada" onUse={() => aplicar.mutate({ amount: s.stretch })} busy={aplicar.isPending} />
            </div>
            <p className="text-xs text-muted-foreground">
              Conta: despesas fixas de <strong>{brl(d.fixed.total)}</strong>
              {d.fixed.source === "FIXOS" ? ` (${d.fixed.count} em Financeiro → Fixos)` : " (média paga dos últimos 3 meses — cadastre as fixas em Financeiro → Fixos para ficar exato)"} ÷ margem de <strong>{s.marginPercent.toLocaleString("pt-BR")}%</strong>
              {d.margin.source === "CONTRATOS"
                ? ` (o que sobrou nos ${d.margin.sample} contratos aceitos dos últimos 6 meses)`
                : ` (mark-up ${d.margin.markup.toLocaleString("pt-BR")} e ${d.margin.commissionPercent.toLocaleString("pt-BR")}% de comissão da precificação; passa a usar os contratos reais quando houver 3 aceitos)`}
              {s.avgTicket ? `. Ticket médio de ${brl(s.avgTicket)}.` : ". Ainda sem vendas para calcular o ticket médio."}{" "}
              <button type="button" className="text-primary hover:underline" onClick={() => setOpen((v) => !v)}>
                {open ? "Ocultar detalhes" : "Ver despesas e divisão por consultor"}
              </button>
            </p>
            {open && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-sm font-medium">Despesas fixas consideradas</p>
                  <table className="w-full text-xs">
                    <tbody>
                      {d.fixed.items.map((i, k) => (
                        <tr key={k} className="border-t border-border">
                          <td className="py-1">{i.description}</td>
                          <td className="py-1 text-muted-foreground">{i.category !== i.description ? i.category : ""}</td>
                          <td className="py-1 text-right tabular-nums">{brl(i.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {d.fixed.count > d.fixed.items.length && <p className="mt-1 text-[11px] text-muted-foreground">e mais {d.fixed.count - d.fixed.items.length}</p>}
                </div>
                {s.bySeller.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm font-medium">Divisão da meta recomendada por consultor</p>
                    <table className="w-full text-xs">
                      <tbody>
                        {s.bySeller.map((x) => (
                          <tr key={x.id} className="border-t border-border">
                            <td className="py-1">{x.name}</td>
                            <td className="py-1 text-right tabular-nums text-muted-foreground">{x.sharePercent.toLocaleString("pt-BR")}%</td>
                            <td className="py-1 text-right tabular-nums">{brl(x.suggested)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-1 text-[11px] text-muted-foreground">{s.sellersBasis === "HISTORY" ? "Proporcional ao que cada um vendeu nos últimos 6 meses." : "Sem vendas recentes: dividida em partes iguais."}</p>
                    <Button size="sm" variant="outline" className="mt-2" disabled={aplicar.isPending} onClick={() => aplicar.mutate({ amount: s.recommended, sellers: s.bySeller })}>
                      Aplicar recomendada à loja e aos consultores
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Nivel({ rotulo, valor, contratos, dica, destaque, onUse, busy }: { rotulo: string; valor: number; contratos: number | null; dica: string; destaque?: boolean; onUse: () => void; busy: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${destaque ? "border-primary bg-primary/5" : "border-border"}`}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-lg font-semibold tabular-nums">{brl(valor)}</p>
      <p className="text-[11px] text-muted-foreground">
        {dica}
        {contratos ? ` · cerca de ${contratos} contrato(s)` : ""}
      </p>
      <Button size="sm" variant={destaque ? "default" : "outline"} className="mt-2 h-7 text-xs" disabled={busy} onClick={onUse}>
        Usar como meta da loja
      </Button>
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
