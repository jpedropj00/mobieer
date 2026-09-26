import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock, Factory, ListChecks, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Metric = "ACTIVITIES_DONE" | "PRODUCTION_STEPS" | "PRODUCTION_HOURS" | "TASKS_DONE";
type Indicators = {
  activitiesDone: number;
  activitiesOpen: number;
  avgActivityMinutes: number | null;
  productionMinutes: number;
  productionSteps: number;
  minutesPerStep: number | null;
  tasksDone: number;
  tasksDoneLate: number;
  tasksOverdueOpen: number;
  onTimeRate: number | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  absences: number | null;
};
type Goal = { metric: Metric; label: string; target: number; actual: number; percent: number | null };
type TeamRow = {
  user: { id: string; name: string; position: string | null; sector: string | null; role: string };
  hasData: boolean;
  indicators: Indicators;
  previous: Indicators;
  goals: Goal[];
};
type Team = {
  month: string;
  totals: { people: number; activitiesDone: number; productionSteps: number; productionMinutes: number; tasksDone: number; tasksOverdueOpen: number };
  rows: TeamRow[];
};
type Detail = {
  user: { id: string; name: string; position: string | null; sector: string | null };
  month: string;
  indicators: Indicators;
  goals: Goal[];
  series: { month: string; indicators: Indicators }[];
};
type Summary = { source: "AI" | "HEURISTIC"; text: string; highlights: string[]; bottlenecks: string[]; aiError?: string };

const METRICS: { metric: Metric; label: string }[] = [
  { metric: "ACTIVITIES_DONE", label: "Atividades concluídas" },
  { metric: "PRODUCTION_STEPS", label: "Etapas de peça concluídas" },
  { metric: "PRODUCTION_HOURS", label: "Horas apontadas na produção" },
  { metric: "TASKS_DONE", label: "Tarefas concluídas" },
];

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const hours = (min: number | null) => (min == null ? "—" : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`);
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
};

/** §5 — Produtividade: a equipe para quem gere, a própria para todos. */
export function ProductivityPage() {
  const { user, can } = useAuth();
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<string | null>(null);
  const seesTeam = can("productivity.read");
  const target = seesTeam ? selected : user?.id ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produtividade"
        description="Indicadores do mês a partir do que foi registrado no sistema: atividades, apontamentos da fábrica, tarefas e ponto."
      />
      <div className="flex flex-wrap items-center gap-3">
        {seesTeam && selected && (
          <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Equipe
          </Button>
        )}
        <Input type="month" className="w-44" value={month} max={currentMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      {target ? <PersonView userId={target} month={month} /> : <TeamView month={month} onOpen={setSelected} />}
    </div>
  );
}

function TeamView({ month, onOpen }: { month: string; onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ["productivity", "team", month], queryFn: () => apiGet<{ data: Team }>("/productivity", { month }) });
  if (q.isLoading) return <PageSkeleton />;
  const d = q.data?.data;
  if (!d) return <p className="py-10 text-center text-sm text-destructive">{errorMessage(q.error, "Falha ao carregar a produtividade")}</p>;
  const rows = [...d.rows].sort((a, b) => Number(b.hasData) - Number(a.hasData));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Atividades concluídas" value={d.totals.activitiesDone} icon={CheckCircle2} />
        <KpiCard title="Etapas de peça na fábrica" value={d.totals.productionSteps} icon={Factory} />
        <KpiCard title="Horas apontadas" value={hours(d.totals.productionMinutes)} icon={Clock} />
        <KpiCard title="Tarefas vencidas em aberto" value={d.totals.tasksOverdueOpen} icon={ListChecks} />
      </div>
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Equipe — {d.totals.people} pessoa(s) com registro no mês</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead className="text-right">Atividades</TableHead>
                <TableHead className="text-right">Etapas</TableHead>
                <TableHead className="text-right">Horas fábrica</TableHead>
                <TableHead className="text-right">Tarefas</TableHead>
                <TableHead className="text-right">No prazo</TableHead>
                <TableHead>Metas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.user.id} className="cursor-pointer" onClick={() => onOpen(r.user.id)}>
                  <TableCell>
                    <span className="font-medium">{r.user.name}</span>
                    <span className="block text-xs text-muted-foreground">{[r.user.position ?? r.user.role, r.user.sector].filter(Boolean).join(" · ")}</span>
                  </TableCell>
                  {r.hasData ? (
                    <>
                      <TableCell className="text-right">{r.indicators.activitiesDone}</TableCell>
                      <TableCell className="text-right">{r.indicators.productionSteps}</TableCell>
                      <TableCell className="text-right">{hours(r.indicators.productionMinutes)}</TableCell>
                      <TableCell className="text-right">
                        {r.indicators.tasksDone}
                        {r.indicators.tasksOverdueOpen > 0 && <Badge variant="danger" className="ml-2">{r.indicators.tasksOverdueOpen} vencida(s)</Badge>}
                      </TableCell>
                      <TableCell className="text-right">{r.indicators.onTimeRate == null ? "—" : `${r.indicators.onTimeRate}%`}</TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">Sem registros no mês</TableCell>
                  )}
                  <TableCell><GoalBadges goals={r.goals} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function GoalBadges({ goals }: { goals: Goal[] }) {
  if (!goals.length) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {goals.map((g) => (
        <Badge key={g.metric} variant={g.percent != null && g.percent >= 100 ? "success" : "secondary"} title={g.label}>
          {g.actual}/{g.target}
        </Badge>
      ))}
    </div>
  );
}

function PersonView({ userId, month }: { userId: string; month: string }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const q = useQuery({
    queryKey: ["productivity", "user", userId, month],
    queryFn: () => apiGet<{ data: Detail }>(`/productivity/users/${userId}`, { month, months: 6 }),
  });
  const summary = useMutation({
    mutationFn: () => apiPost<{ data: Summary }>(`/productivity/users/${userId}/summary`, { month }),
    onError: (e) => toast.error(errorMessage(e, "Falha ao gerar o resumo")),
  });
  useEffect(() => summary.reset(), [userId, month]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <PageSkeleton />;
  const d = q.data?.data;
  if (!d) return <p className="py-10 text-center text-sm text-destructive">{errorMessage(q.error, "Falha ao carregar a produtividade")}</p>;
  const i = d.indicators;
  const s = summary.data?.data;

  return (
    <>
      <div>
        <h2 className="text-lg font-semibold">{d.user.name}</h2>
        <p className="text-sm text-muted-foreground">{[d.user.position, d.user.sector].filter(Boolean).join(" · ") || "—"}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Atividades concluídas" value={i.activitiesDone} icon={CheckCircle2} />
        <KpiCard title="Etapas de peça" value={i.productionSteps} icon={Factory} />
        <KpiCard title="Horas apontadas" value={hours(i.productionMinutes)} icon={Clock} />
        <KpiCard title="Tarefas no prazo" value={i.onTimeRate == null ? "—" : `${i.onTimeRate}%`} icon={ListChecks} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="text-base">Metas do mês</CardTitle>
            {can("productivity.manage") && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Target className="mr-1 h-4 w-4" /> Definir metas
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {d.goals.length === 0 && <p className="text-muted-foreground">Nenhuma meta definida para este mês.</p>}
            {d.goals.map((g) => (
              <div key={g.metric} className="space-y-1">
                <div className="flex justify-between"><span>{g.label}</span><span className="font-medium">{g.actual} de {g.target}</span></div>
                <div className="h-2 overflow-hidden rounded bg-muted">
                  <div className={g.percent != null && g.percent >= 100 ? "h-full bg-emerald-500" : "h-full bg-primary"} style={{ width: `${Math.min(100, g.percent ?? 0)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3"><CardTitle className="text-base">Detalhes</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Atividades em aberto</dt><dd>{i.activitiesOpen}</dd>
              <dt className="text-muted-foreground">Duração média da atividade</dt><dd>{hours(i.avgActivityMinutes)}</dd>
              <dt className="text-muted-foreground">Minutos por etapa</dt><dd>{i.minutesPerStep ?? "—"}</dd>
              <dt className="text-muted-foreground">Tarefas concluídas / com atraso</dt><dd>{i.tasksDone} / {i.tasksDoneLate}</dd>
              <dt className="text-muted-foreground">Tarefas vencidas em aberto</dt><dd>{i.tasksOverdueOpen}</dd>
              <dt className="text-muted-foreground">Horas no ponto / extras</dt><dd>{hours(i.workedMinutes)} / {hours(i.overtimeMinutes)}</dd>
              <dt className="text-muted-foreground">Dias sem marcação</dt><dd>{i.absences ?? "—"}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-base">Evolução — últimos {d.series.length} meses</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Atividades</TableHead>
                <TableHead className="text-right">Etapas</TableHead>
                <TableHead className="text-right">Horas fábrica</TableHead>
                <TableHead className="text-right">Min/etapa</TableHead>
                <TableHead className="text-right">Tarefas</TableHead>
                <TableHead className="text-right">No prazo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.series.map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="capitalize">{monthLabel(m.month)}</TableCell>
                  <TableCell className="text-right">{m.indicators.activitiesDone}</TableCell>
                  <TableCell className="text-right">{m.indicators.productionSteps}</TableCell>
                  <TableCell className="text-right">{hours(m.indicators.productionMinutes)}</TableCell>
                  <TableCell className="text-right">{m.indicators.minutesPerStep ?? "—"}</TableCell>
                  <TableCell className="text-right">{m.indicators.tasksDone}</TableCell>
                  <TableCell className="text-right">{m.indicators.onTimeRate == null ? "—" : `${m.indicators.onTimeRate}%`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-base">Resumo do mês</CardTitle>
          <Button size="sm" variant="outline" disabled={summary.isPending} onClick={() => summary.mutate()}>
            <Sparkles className="mr-1 h-4 w-4" /> {summary.isPending ? "Gerando…" : s ? "Gerar de novo" : "Gerar resumo"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!s && <p className="text-muted-foreground">Um texto curto com o que foi entregue e os pontos de atenção, só com os números acima.</p>}
          {s && (
            <>
              <p>{s.text}</p>
              {s.bottlenecks.length > 0 && (
                <div>
                  <p className="font-medium">Pontos de atenção</p>
                  <ul className="list-disc pl-5">{s.bottlenecks.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {s.source === "AI" ? "Escrito pela IA a partir dos números do mês." : "Montado direto dos números do mês."}
                {s.aiError && ` A IA não respondeu (${s.aiError}).`}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {editing && <GoalsDialog userId={userId} month={month} goals={d.goals} onClose={() => setEditing(false)} />}
    </>
  );
}

function GoalsDialog({ userId, month, goals, onClose }: { userId: string; month: string; goals: Goal[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<Metric, string>>(() => {
    const v = { ACTIVITIES_DONE: "", PRODUCTION_STEPS: "", PRODUCTION_HOURS: "", TASKS_DONE: "" };
    for (const g of goals) v[g.metric] = String(g.target);
    return v;
  });
  const save = useMutation({
    mutationFn: () => {
      const list = METRICS.filter((m) => values[m.metric].trim() !== "").map((m) => ({ metric: m.metric, target: Number(values[m.metric]) }));
      if (list.some((g) => !Number.isInteger(g.target) || g.target < 0)) throw new Error("Use números inteiros a partir de zero");
      return apiPut<{ message: string }>(`/productivity/users/${userId}/goals`, { month, goals: list });
    },
    onSuccess: (r) => {
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["productivity"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar as metas")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Metas de {monthLabel(month)}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Deixe vazio o que não tiver meta.</p>
        <div className="space-y-3">
          {METRICS.map((m) => (
            <label key={m.metric} className="flex items-center justify-between gap-3 text-sm">
              <span>{m.label}</span>
              <Input
                type="number"
                min={0}
                className="w-28"
                value={values[m.metric]}
                onChange={(e) => setValues((v) => ({ ...v, [m.metric]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Salvar metas</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
