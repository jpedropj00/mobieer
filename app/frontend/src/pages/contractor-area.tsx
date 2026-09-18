import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, LogIn, LogOut, MapPin, MessagesSquare, Pause, Play, Plus, Trophy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiGet, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";

export type InstallationTask = {
  id: string;
  project: { id: string; code: string; name: string; client: { name: string } };
  contractor: { id: string; name: string };
  roomType: string;
  roomTypeLabel: string;
  roomLabel: string | null;
  status: "PENDING" | "IN_PROGRESS" | "PAUSED" | "DONE" | "CANCELLED";
  startedAt: string | null;
  finishedAt: string | null;
  workedMinutes: number;
  liveMinutes: number;
  runningSince: string | null;
  targetMinutes: number | null;
  gainPct: number | null;
  review: "PENDING" | "APPROVED" | "REJECTED";
  reviewNotes: string | null;
  notes: string | null;
  bonus: { id: string; amount: number; gainPct: number; status: string } | null;
  createdAt: string;
};

type Home = {
  contractor: { id: string; name: string; specialty: string | null; dailyRate: number };
  openShift: { id: string; checkInAt: string; project: { id: string; code: string; name: string } | null } | null;
  tasks: InstallationTask[];
  projects: { id: string; code: string; name: string; clientName: string; address: string | null }[];
  roomTypes: { key: string; label: string }[];
};

type Productivity = {
  summary: { rooms: number; hours: number; avgGainPct: number | null; roomsAboveTarget: number; bonusTotal: number; byRoom: { roomType: string; label: string; count: number; medianMinutes: number; bestMinutes: number }[] };
  targets: { roomType: string; label: string; samples: number; targetMinutes: number | null; missingForTarget: number }[];
  minSamples: number;
  bonuses: { id: string; roomTypeLabel: string; roomLabel: string | null; projectCode: string; gainPct: number; amount: number; status: string; createdAt: string }[];
  bonusPending: number;
  bonusPaid: number;
};

export const hm = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const clock = (v: string) => new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Minutos correndo em tempo real enquanto o cômodo está em andamento. */
function useLiveMinutes(task: InstallationTask) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!task.runningSince) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [task.runningSince]);
  if (!task.runningSince) return task.workedMinutes;
  return task.workedMinutes + Math.max(0, Math.round((now - new Date(task.runningSince).getTime()) / 60000));
}

export function ContractorAreaPage() {
  const qc = useQueryClient();
  const home = useQuery({ queryKey: ["me-contractor"], queryFn: () => apiGet<{ data: Home }>("/me/contractor") });
  const prod = useQuery({ queryKey: ["me-contractor", "productivity"], queryFn: () => apiGet<{ data: Productivity }>("/me/contractor/productivity") });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["me-contractor"] });
  };

  const [checkinProject, setCheckinProject] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [room, setRoom] = useState({ projectId: "", roomType: "", roomLabel: "" });

  const checkIn = useMutation({
    mutationFn: () => apiPost<{ message?: string }>("/me/contractor/check-in", { projectId: checkinProject || null }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Entrada registrada");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha no check-in")),
  });
  const checkOut = useMutation({
    mutationFn: () => apiPost<{ message?: string }>("/me/contractor/check-out"),
    onSuccess: (r) => {
      toast.success(r.message ?? "Saída registrada");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha no check-out")),
  });
  const addRoom = useMutation({
    mutationFn: () => apiPost("/me/contractor/tasks", { ...room, roomLabel: room.roomLabel || null }),
    onSuccess: () => {
      toast.success("Cômodo adicionado");
      setAddOpen(false);
      setRoom({ projectId: "", roomType: "", roomLabel: "" });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível adicionar")),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "start" | "pause" | "finish" }) =>
      apiPost<{ message?: string }>(`/me/contractor/tasks/${id}/${action}`, {}),
    onSuccess: (r) => {
      toast.success(r.message ?? "Atualizado");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível atualizar o cômodo")),
  });

  if (home.isLoading) return <PageSkeleton />;
  if (home.isError) {
    return <EmptyState title="Área do montador indisponível" description={errorMessage(home.error, "Fale com a gestão.")} />;
  }
  const h = home.data!.data;
  const shift = h.openShift;
  const running = h.tasks.find((t) => t.status === "IN_PROGRESS");

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={`Olá, ${h.contractor.name.split(" ")[0]}`} description="Registre sua entrada, os cômodos que montar e acompanhe sua produtividade.">
        <Button asChild variant="outline" size="sm">
          <Link to="/chat">
            <MessagesSquare className="mr-2 h-4 w-4" /> Chat
          </Link>
        </Button>
      </PageHeader>

      <Tabs defaultValue="hoje">
        <TabsList className="w-full">
          <TabsTrigger value="hoje" className="flex-1">Hoje</TabsTrigger>
          <TabsTrigger value="produtividade" className="flex-1">Minha produtividade</TabsTrigger>
        </TabsList>

        <TabsContent value="hoje" className="space-y-4 pt-4">
          <Card className={shift ? "border-primary/40" : ""}>
            <CardContent className="space-y-3 pt-6">
              {shift ? (
                <>
                  <div className="flex items-center gap-3">
                    <Clock className="h-6 w-6 text-primary" />
                    <div>
                      <p className="font-medium">Na obra desde {clock(shift.checkInAt)}</p>
                      <p className="text-sm text-muted-foreground">{shift.project ? `${shift.project.code} — ${shift.project.name}` : "Sem obra informada"}</p>
                    </div>
                  </div>
                  <Button className="w-full" size="lg" variant="outline" disabled={checkOut.isPending || Boolean(running)} onClick={() => checkOut.mutate()}>
                    <LogOut className="mr-2 h-5 w-5" /> Registrar saída
                  </Button>
                  {running && <p className="text-center text-xs text-muted-foreground">Pause ou conclua o cômodo em andamento antes de sair.</p>}
                </>
              ) : (
                <>
                  <Label>Obra</Label>
                  <Select value={checkinProject || "NONE"} onValueChange={(v) => setCheckinProject(v === "NONE" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha a obra" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Sem obra específica</SelectItem>
                      {h.projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.code} — {p.clientName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {checkinProject && (
                    <p className="flex items-start gap-1 text-xs text-muted-foreground">
                      <MapPin className="mt-0.5 h-3.5 w-3.5" />
                      {h.projects.find((p) => p.id === checkinProject)?.address ?? "Endereço não cadastrado"}
                    </p>
                  )}
                  <Button className="w-full" size="lg" disabled={checkIn.isPending} onClick={() => checkIn.mutate()}>
                    <LogIn className="mr-2 h-5 w-5" /> Registrar entrada
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Cômodos</h2>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} disabled={!h.projects.length}>
              <Plus className="mr-1 h-4 w-4" /> Cômodo
            </Button>
          </div>
          {h.tasks.length === 0 ? (
            <EmptyState title="Nenhum cômodo em aberto" description="Adicione o cômodo que vai montar para marcar o tempo." />
          ) : (
            h.tasks.map((t) => <TaskCard key={t.id} task={t} busy={act.isPending} canStart={Boolean(shift)} onAction={(action) => act.mutate({ id: t.id, action })} />)
          )}
        </TabsContent>

        <TabsContent value="produtividade" className="space-y-4 pt-4">
          {prod.isLoading ? (
            <PageSkeleton />
          ) : prod.data ? (
            <ProductivityView p={prod.data.data} />
          ) : (
            <p className="text-sm text-muted-foreground">{errorMessage(prod.error, "Não foi possível carregar")}</p>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar cômodo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Obra</Label>
              <Select value={room.projectId} onValueChange={(v) => setRoom({ ...room, projectId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a obra" />
                </SelectTrigger>
                <SelectContent>
                  {h.projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.clientName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo de cômodo</Label>
              <Select value={room.roomType} onValueChange={(v) => setRoom({ ...room, roomType: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {h.roomTypes.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nome (opcional)</Label>
              <Input value={room.roomLabel} onChange={(e) => setRoom({ ...room, roomLabel: e.target.value })} placeholder="Ex.: Banheiro da suíte" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={!room.projectId || !room.roomType || addRoom.isPending} onClick={() => addRoom.mutate()}>
              {addRoom.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskCard({ task, busy, canStart, onAction }: { task: InstallationTask; busy: boolean; canStart: boolean; onAction: (a: "start" | "pause" | "finish") => void }) {
  const minutes = useLiveMinutes(task);
  const target = task.targetMinutes;
  const pct = target ? Math.min(100, Math.round((minutes / target) * 100)) : null;
  return (
    <Card className={task.status === "IN_PROGRESS" ? "border-primary" : ""}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{task.roomLabel || task.roomTypeLabel}</p>
            <p className="text-xs text-muted-foreground">
              {task.project.code} — {task.project.client.name}
            </p>
          </div>
          {task.status === "DONE" ? (
            <Badge variant={task.review === "REJECTED" ? "danger" : "secondary"}>{task.review === "PENDING" ? "Aguardando validação" : task.review === "REJECTED" ? "Reprovado" : "Aprovado"}</Badge>
          ) : task.status === "IN_PROGRESS" ? (
            <Badge>Em andamento</Badge>
          ) : task.status === "PAUSED" ? (
            <Badge variant="warning">Pausado</Badge>
          ) : (
            <Badge variant="muted">Não iniciado</Badge>
          )}
        </div>

        <div className="flex items-end justify-between">
          <p className="text-3xl font-semibold tabular-nums">{hm(minutes)}</p>
          <p className="text-xs text-muted-foreground">{target ? `sua meta: ${hm(target)}` : "meta ainda em formação"}</p>
        </div>
        {pct !== null && task.status !== "DONE" && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={`h-full ${minutes <= (target ?? 0) ? "bg-primary" : "bg-warning"}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        {task.reviewNotes && task.review === "REJECTED" && <p className="text-xs text-destructive">Gestão: {task.reviewNotes}</p>}

        {task.status !== "DONE" && (
          <div className="grid grid-cols-2 gap-2">
            {task.status === "IN_PROGRESS" ? (
              <Button variant="outline" size="lg" disabled={busy} onClick={() => onAction("pause")}>
                <Pause className="mr-2 h-5 w-5" /> Pausar
              </Button>
            ) : (
              <Button size="lg" disabled={busy || !canStart} onClick={() => onAction("start")} title={canStart ? undefined : "Registre a entrada primeiro"}>
                <Play className="mr-2 h-5 w-5" /> {task.status === "PAUSED" ? "Retomar" : "Iniciar"}
              </Button>
            )}
            <Button
              variant="secondary"
              size="lg"
              disabled={busy || task.status === "PENDING"}
              onClick={() => {
                if (confirm("Concluir este cômodo? Ele vai para a validação da gestão.")) onAction("finish");
              }}
            >
              <CheckCircle2 className="mr-2 h-5 w-5" /> Concluir
            </Button>
          </div>
        )}
        {task.status !== "DONE" && !canStart && task.status !== "IN_PROGRESS" && (
          <p className="text-center text-xs text-muted-foreground">Registre a entrada para iniciar o cronômetro.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ProductivityView({ p }: { p: Productivity }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Cômodos (90 dias)" value={String(p.summary.rooms)} />
        <Stat label="Horas montando" value={`${p.summary.hours.toLocaleString("pt-BR")}h`} />
        <Stat label="Acima da sua meta" value={String(p.summary.roomsAboveTarget)} />
        <Stat label="Bônus a receber" value={brl(p.bonusPending)} highlight />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Sua meta por tipo de cômodo</CardTitle>
          <p className="text-xs text-muted-foreground">
            A meta é o seu próprio tempo típico (mediana dos seus últimos cômodos aprovados). Ser mais rápido que você mesmo gera bônus.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {p.targets.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Monte e tenha cômodos aprovados para formar sua meta.</p>
          ) : (
            p.targets.map((t) => (
              <div key={t.roomType} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>{t.label}</span>
                {t.targetMinutes ? (
                  <span className="font-medium tabular-nums">{hm(t.targetMinutes)}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">faltam {t.missingForTarget} para ter meta</span>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Trophy className="h-4 w-4 text-primary" /> Bônus
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {p.bonuses.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nenhum bônus nos últimos 90 dias.</p>
          ) : (
            p.bonuses.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <div>
                  <p>{b.roomLabel || b.roomTypeLabel} · {b.projectCode}</p>
                  <p className="text-xs text-muted-foreground">{b.gainPct.toLocaleString("pt-BR")}% mais rápido que sua meta</p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{brl(b.amount)}</p>
                  <p className="text-xs text-muted-foreground">{b.status === "PAID" ? "pago" : "a receber"}</p>
                </div>
              </div>
            ))
          )}
          {p.bonusPaid > 0 && <p className="text-right text-xs text-muted-foreground">Já recebido no período: {brl(p.bonusPaid)}</p>}
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
