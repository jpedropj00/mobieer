import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "@/services/api";
import type { ChartData, ChartPeriod } from "@/types";
import { formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

const PERIODS: { value: ChartPeriod; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "3m", label: "3 meses" },
  { value: "6m", label: "6 meses" },
  { value: "1y", label: "1 ano" },
];

export function MovementsChart() {
  const [period, setPeriod] = useState<ChartPeriod>("30d");

  const { data, isFetching } = useQuery({
    queryKey: ["dashboard-chart", period],
    queryFn: () => apiGet<{ data: ChartData }>("/dashboard/chart", { period }),
  });

  const chart = data?.data;

  const points =
    chart?.labels.map((label, i) => ({
      date: label,
      Entradas: chart.entries[i],
      Saídas: chart.exits[i],
      Saldo: chart.balance[i],
    })) ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                period === p.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {chart && (
          <div className="rounded-lg border bg-success/5 px-3 py-1.5 text-sm">
            <span className="text-muted-foreground">Saldo atual: </span>
            <span className="font-bold text-success">{formatNumber(chart.currentBalance)} unidades</span>
          </div>
        )}
      </div>

      <div className="h-[300px] w-full">
        {!chart && isFetching && <ChartLoading />}
        {chart && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
              <defs>
                <linearGradient id="gEntries" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#15803d" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#15803d" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gExits" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gBalance" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ea580c" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ea580c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: string) => v.slice(5)}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.08)" }}
                labelFormatter={(v) => {
                  const d = new Date(v as string);
                  return d.toLocaleDateString("pt-BR");
                }}
                formatter={(value) => [formatNumber(Number(value)), ""]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="Entradas" stroke="#15803d" strokeWidth={2} fill="url(#gEntries)" />
              <Area type="monotone" dataKey="Saídas" stroke="#dc2626" strokeWidth={2} fill="url(#gExits)" />
              <Area type="monotone" dataKey="Saldo" stroke="#ea580c" strokeWidth={2} fill="url(#gBalance)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function ChartLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <div className="h-40 w-full animate-pulse rounded-lg bg-muted" />
        <p>Carregando gráfico...</p>
      </div>
    </div>
  );
}
