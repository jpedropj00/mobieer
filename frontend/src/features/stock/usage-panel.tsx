import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Loader2 } from "lucide-react";
import { apiGet } from "@/services/api";
import type { Product } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type UsageData = { mostUsed: { product: Product; quantity: number; movements: number }[]; stagnant: Product[] };

export function UsagePanel() {
  const [days, setDays] = useState("90");
  const { data, isLoading } = useQuery({ queryKey: ["stock-usage", days], queryFn: () => apiGet<{ data: UsageData }>("/stock-operations/usage", { days }) });
  const max = useMemo(() => Math.max(1, ...(data?.data.mostUsed.map((item) => item.quantity) ?? [1])), [data]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="flex items-center gap-2 text-lg font-semibold"><BarChart3 className="h-5 w-5 text-primary" />Utilização do estoque</h2><p className="text-sm text-muted-foreground">Produtos mais consumidos e itens sem movimentação no período.</p></div>
        <Select value={days} onValueChange={setDays}><SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">Últimos 30 dias</SelectItem><SelectItem value="90">Últimos 90 dias</SelectItem><SelectItem value="180">Últimos 180 dias</SelectItem><SelectItem value="365">Último ano</SelectItem></SelectContent></Select>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Produtos mais utilizados</CardTitle></CardHeader><CardContent className="space-y-3">{isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : data?.data.mostUsed.length ? data.data.mostUsed.map((item) => <div key={item.product.id}><div className="flex justify-between gap-3 text-sm"><span className="truncate">{item.product.name}</span><strong>{item.quantity}</strong></div><div className="mt-1 h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${item.quantity / max * 100}%` }} /></div></div>) : <p className="text-sm text-muted-foreground">Nenhuma saída registrada no período.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Produtos parados</CardTitle></CardHeader><CardContent className="space-y-2">{isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : data?.data.stagnant.length ? data.data.stagnant.map((item) => <div key={item.id} className="flex justify-between gap-3 rounded border p-2 text-sm"><span className="truncate">{item.name}</span><span className="shrink-0 text-muted-foreground">Saldo {item.stock}</span></div>) : <p className="text-sm text-muted-foreground">Nenhum produto parado no período.</p>}</CardContent></Card>
      </div>
    </section>
  );
}
