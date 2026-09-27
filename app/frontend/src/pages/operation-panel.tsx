import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { apiGet } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Point = { key: string; value: number };
type Data = {
  period: { key: string; label: string; bucket: "day" | "month" };
  generatedAt: string;
  clients: { new: number; active: number; newLeads: number };
  sales: { contracts: number; value: number; avgTicket: number; conversion: number | null; quotesApproved: number; quotesOpen: number; pipeline: { count: number; value: number }; series: Point[]; countSeries: Point[]; ranking: { name: string; value: number; count: number }[] };
  sheets: { used: number; usedSeries: Point[]; plannedArea: number; planned: number; projectsReleased: number };
  assistance: { opened: number; resolved: number; openNow: number; avgResolveDays: number | null; byStatus: { key: string; label: string; value: number }[]; byProblem: { label: string; value: number }[]; openedSeries: Point[] };
  production: { byStage: { key: string; label: string; value: number }[]; delivered: number };
  installation: { done: number; next7days: number };
};

const PERIODS = [
  ["today", "Hoje"],
  ["7d", "7 dias"],
  ["month", "Mês"],
  ["year", "Ano"],
] as const;

// Tema da "sala de controle": sempre escuro (é uma tela de TV), paleta validada para a superfície azul-marinho.
const THEME = {
  "--pnl-bg": "#0b1220",
  "--pnl-surface": "#0e1726",
  "--pnl-border": "#1d2b44",
  "--pnl-grid": "#1a2740",
  "--pnl-text": "#ffffff",
  "--pnl-text-2": "#c3cad8",
  "--pnl-muted": "#8391a8",
  "--pnl-s1": "#3987e5",
  "--pnl-s2": "#d95926",
  "--pnl-s3": "#199e70",
} as React.CSSProperties;

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlShort = (v: number) => (v >= 1_000_000 ? `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")} mi` : v >= 1000 ? `R$ ${Math.round(v / 1000)} mil` : brl(v));
const int = (v: number) => v.toLocaleString("pt-BR");
const tick = (k: string, bucket: "day" | "month") => {
  if (bucket === "month") return ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(k.slice(5, 7)) - 1];
  return `${k.slice(8, 10)}/${k.slice(5, 7)}`;
};

/** Painel da operação — a tela da "sala de controle": clientes, vendas, chapas, ATs, produção e montagem. */
export function OperationPanelPage() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("month");
  const [full, setFull] = useState(false);
  const [clock, setClock] = useState(new Date());
  const root = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["operation-panel", period],
    queryFn: () => apiGet<{ data: Data }>("/dashboard/operation", { period }),
    refetchInterval: 60_000, // TV ligada o dia todo: atualiza sozinha a cada minuto
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    const onFs = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => { clearInterval(t); document.removeEventListener("fullscreenchange", onFs); };
  }, []);
  const toggleFull = () => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())?.catch(() => undefined);
  const d = q.data?.data;

  return (
    <div ref={root} style={THEME} className={`${full ? "h-screen overflow-y-auto" : "-m-4 min-h-[calc(100vh-4rem)] sm:-m-6"} bg-[var(--pnl-bg)] p-4 text-[var(--pnl-text)] sm:p-6`}>
      <header className="mb-4 flex flex-wrap items-center gap-3 border-b border-[var(--pnl-border)] pb-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold tracking-wide sm:text-2xl">Central de Operações</h1>
          <p className="text-xs text-[var(--pnl-muted)]">{d ? `${d.period.label} · atualizado ${new Date(d.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Carregando…"}</p>
        </div>
        <div className="flex rounded-md border border-[var(--pnl-border)] p-0.5" role="tablist" aria-label="Período">
          {PERIODS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={period === k} onClick={() => setPeriod(k)} className={`rounded px-3 py-1 text-sm ${period === k ? "bg-[var(--pnl-s1)] text-white" : "text-[var(--pnl-text-2)] hover:text-white"}`}>
              {l}
            </button>
          ))}
        </div>
        <span className="font-mono text-2xl tabular-nums text-[var(--pnl-text-2)]">{clock.toLocaleTimeString("pt-BR")}</span>
        <button onClick={() => void q.refetch()} className="rounded p-2 text-[var(--pnl-text-2)] hover:bg-[var(--pnl-surface)]" aria-label="Atualizar"><RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /></button>
        <button onClick={toggleFull} className="flex items-center gap-1 rounded border border-[var(--pnl-border)] px-3 py-1.5 text-sm text-[var(--pnl-text-2)] hover:text-white">
          {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} {full ? "Sair da tela cheia" : "Modo TV"}
        </button>
      </header>

      {q.isError && <p className="rounded border border-[var(--pnl-border)] p-4 text-sm text-[#e66767]">{errorMessage(q.error, "Não foi possível carregar o painel")}</p>}
      {d && (
        <div className="space-y-4">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Clientes novos" value={int(d.clients.new)} sub={`${int(d.clients.active)} ativos · ${int(d.clients.newLeads)} leads`} />
            <Tile label="Vendido" value={brlShort(d.sales.value)} sub={`${int(d.sales.contracts)} contrato(s)${d.sales.conversion != null ? ` · conversão ${d.sales.conversion}%` : ""}`} />
            <Tile label="Ticket médio" value={d.sales.contracts ? brlShort(d.sales.avgTicket) : "—"} sub={`${int(d.sales.pipeline.count)} em negociação · ${brlShort(d.sales.pipeline.value)}`} />
            <Tile label="Chapas consumidas" value={int(d.sheets.used)} sub={d.sheets.planned ? `≈ ${int(d.sheets.planned)} previstas no Promob` : `${int(d.sheets.projectsReleased)} projeto(s) liberado(s)`} />
            <Tile label="ATs em aberto" value={int(d.assistance.openNow)} sub={`${int(d.assistance.opened)} abertas · ${int(d.assistance.resolved)} resolvidas${d.assistance.avgResolveDays != null ? ` · ${String(d.assistance.avgResolveDays).replace(".", ",")} d` : ""}`} />
            <Tile label="Montagens concluídas" value={int(d.installation.done)} sub={`${int(d.installation.next7days)} agendada(s) em 7 dias · ${int(d.production.delivered)} entrega(s)`} />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1fr_2fr_1fr]">
            <Panel title="Ranking de vendas">
              {d.sales.ranking.length === 0 ? (
                <Empty text="Nenhuma venda no período" />
              ) : (
                <ol className="space-y-3">
                  {d.sales.ranking.map((r, i) => (
                    <li key={r.name}>
                      <div className="flex justify-between text-sm">
                        <span className="text-[var(--pnl-text)]">{i + 1}. {r.name}</span>
                        <span className="tabular-nums text-[var(--pnl-text-2)]">{brlShort(r.value)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-[var(--pnl-grid)]">
                        <div className="h-1.5 rounded-full bg-[var(--pnl-s1)]" style={{ width: `${Math.max(4, (r.value / d.sales.ranking[0].value) * 100)}%` }} />
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--pnl-muted)]">{r.count} contrato(s)</p>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            <Panel title={d.period.bucket === "month" ? "Vendas por mês (R$)" : "Vendas por dia (R$)"}>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={d.sales.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pnl-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3987e5" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#3987e5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--pnl-grid)" />
                    <XAxis dataKey="key" tickFormatter={(k) => tick(k, d.period.bucket)} tick={{ fill: "#8391a8", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
                    <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fill: "#8391a8", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip content={<PanelTip bucket={d.period.bucket} format={brl} name="Vendido" />} cursor={{ stroke: "#8391a8", strokeWidth: 1 }} />
                    <Area type="monotone" dataKey="value" stroke="#3987e5" strokeWidth={2} fill="url(#pnl-area)" activeDot={{ r: 5, stroke: "#0e1726", strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="ATs no período">
              {d.assistance.opened + d.assistance.openNow === 0 ? (
                <Empty text="Nenhuma assistência técnica" />
              ) : (
                <>
                  <div className="relative h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[{ name: "Resolvidas no período", value: d.assistance.resolved }, { name: "Em aberto agora", value: d.assistance.openNow }]}
                          dataKey="value"
                          innerRadius="68%"
                          outerRadius="92%"
                          stroke="#0e1726"
                          strokeWidth={2}
                          startAngle={90}
                          endAngle={-270}
                        >
                          <Cell fill="#199e70" />
                          <Cell fill="#d95926" />
                        </Pie>
                        <Tooltip content={<PanelTip format={int} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-semibold tabular-nums">{int(d.assistance.openNow)}</span>
                      <span className="text-xs text-[var(--pnl-muted)]">em aberto</span>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs">
                    <Legend color="#199e70" label="Resolvidas no período" value={int(d.assistance.resolved)} />
                    <Legend color="#d95926" label="Em aberto agora" value={int(d.assistance.openNow)} />
                  </ul>
                </>
              )}
            </Panel>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Panel title={d.period.bucket === "month" ? "Chapas consumidas por mês" : "Chapas consumidas por dia"}>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.sheets.usedSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke="var(--pnl-grid)" />
                    <XAxis dataKey="key" tickFormatter={(k) => tick(k, d.period.bucket)} tick={{ fill: "#8391a8", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
                    <YAxis allowDecimals={false} tick={{ fill: "#8391a8", fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip content={<PanelTip bucket={d.period.bucket} format={int} name="Chapas" />} cursor={{ fill: "rgba(131,145,168,0.12)" }} />
                    <Bar dataKey="value" fill="#199e70" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-[var(--pnl-muted)]">
                Saídas do estoque de chapas (MDF/MDP/compensado).{d.sheets.plannedArea ? ` Projetos liberados no período: ${String(d.sheets.plannedArea).replace(".", ",")} m² de peças ≈ ${int(d.sheets.planned)} chapas 2,75×1,84 (+10% de perda).` : ""}
              </p>
            </Panel>

            <Panel title="Produção em andamento">
              <BarList items={d.production.byStage} empty="Nenhum pedido em produção" />
              <p className="mt-3 text-xs text-[var(--pnl-muted)]">{int(d.production.delivered)} pedido(s) entregue(s) no período</p>
            </Panel>

            <Panel title="Motivos das ATs abertas no período">
              <BarList items={d.assistance.byProblem} empty="Nenhuma AT aberta no período" />
              <p className="mt-3 text-xs text-[var(--pnl-muted)]">
                {d.assistance.byStatus.filter((s) => s.value).map((s) => `${s.label}: ${s.value}`).join(" · ") || "Nada em aberto"}
              </p>
            </Panel>
          </section>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-[var(--pnl-border)] bg-[var(--pnl-surface)] p-3">
      <p className="text-xs uppercase tracking-wider text-[var(--pnl-muted)]">{label}</p>
      <p className="mt-1 whitespace-nowrap text-2xl font-semibold tabular-nums 2xl:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-[var(--pnl-text-2)]">{sub}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--pnl-border)] bg-[var(--pnl-surface)] p-4">
      <h2 className="mb-3 text-sm font-medium text-[var(--pnl-text-2)]">{title}</h2>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="py-8 text-center text-sm text-[var(--pnl-muted)]">{text}</p>;

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <li className="flex items-center justify-between text-[var(--pnl-text-2)]">
      <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}</span>
      <span className="tabular-nums text-[var(--pnl-text)]">{value}</span>
    </li>
  );
}

/** Barras horizontais de uma cor só, com rótulo e valor em texto (a cor não carrega o dado). */
function BarList({ items, empty }: { items: { label: string; value: number }[]; empty: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  if (!max) return <Empty text={empty} />;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label} title={`${i.label}: ${i.value}`}>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--pnl-text-2)]">{i.label}</span>
            <span className="tabular-nums">{i.value}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-[var(--pnl-grid)]">
            {i.value > 0 && <div className="h-2 rounded-full bg-[var(--pnl-s1)]" style={{ width: `${Math.max(3, (i.value / max) * 100)}%` }} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PanelTip({ active, payload, label, bucket, format, name }: { active?: boolean; payload?: { value: number; name?: string; payload?: { name?: string } }[]; label?: string; bucket?: "day" | "month"; format: (v: number) => string; name?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded border border-[#1d2b44] bg-[#0b1220] px-3 py-2 text-xs text-white shadow-lg">
      {label && bucket && <p className="text-[#8391a8]">{tick(label, bucket)}</p>}
      <p>{name ?? p.payload?.name ?? p.name}: <strong>{format(p.value)}</strong></p>
    </div>
  );
}
