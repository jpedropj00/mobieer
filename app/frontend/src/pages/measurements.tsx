import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarCheck, CheckCircle2, Clock, Loader2, Ruler } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiGet, apiPatch, apiPost } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/utils";

export type MeasurementVisit = {
  id: string;
  status: "REQUESTED" | "SCHEDULED" | "DONE" | "CANCELLED";
  preferredDates: string[];
  preferredPeriod: string | null;
  clientNotes: string | null;
  scheduledAt: string | null;
  teamNotes: string | null;
  doneAt: string | null;
  techProjectDueAt: string | null;
  daysToTechDeadline: number | null;
  createdAt: string;
  technician: { id: string; name: string } | null;
  project?: { id: string; code: string; name: string; clientName: string | null };
};
type Person = { id: string; name: string };

const STATUS_LABEL: Record<MeasurementVisit["status"], string> = {
  REQUESTED: "Solicitada", SCHEDULED: "Agendada", DONE: "Concluída", CANCELLED: "Cancelada",
};
const PERIOD_LABEL: Record<string, string> = { MANHA: "Manhã", TARDE: "Tarde", QUALQUER: "Qualquer horário" };
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const fmtDateTime = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function toLocalInput(v: string | null) {
  const d = v ? new Date(v) : new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

/* ============================ hooks ============================ */

function useMeasurementActions(invalidate: () => void) {
  const qc = useQueryClient();
  const done = () => { invalidate(); qc.invalidateQueries({ queryKey: ["notifications"] }); };
  const schedule = useMutation({
    mutationFn: ({ id, scheduledAt, technicianId, teamNotes }: { id: string; scheduledAt: string; technicianId: string | null; teamNotes: string }) =>
      apiPatch(`/measurements/${id}`, { action: "schedule", scheduledAt: new Date(scheduledAt).toISOString(), technicianId: technicianId || null, teamNotes: teamNotes || null }),
    onSuccess: () => { toast.success("Medição agendada"); done(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao agendar")),
  });
  const markDone = useMutation({
    mutationFn: ({ id, teamNotes }: { id: string; teamNotes: string }) => apiPost(`/measurements/${id}/done`, { teamNotes: teamNotes || null }),
    onSuccess: () => { toast.success("Medição concluída — prazo do projeto técnico iniciado"); done(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao concluir")),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => apiPatch(`/measurements/${id}`, { action: "cancel" }),
    onSuccess: () => { toast.success("Medição cancelada"); done(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao cancelar")),
  });
  const create = useMutation({
    mutationFn: ({ projectId, scheduledAt, technicianId }: { projectId: string; scheduledAt: string | null; technicianId: string | null }) =>
      apiPost(`/measurements/projects/${projectId}`, {
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        technicianId: technicianId || null,
      }),
    onSuccess: () => { toast.success("Medição criada"); done(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao criar")),
  });
  return { schedule, markDone, cancel, create };
}

/* ============================ card ============================ */

export function MeasurementCard({
  visit, people, canManage, invalidate, showProject = true,
}: {
  visit: MeasurementVisit;
  people: Person[];
  canManage: boolean;
  invalidate: () => void;
  showProject?: boolean;
}) {
  const { schedule, markDone, cancel } = useMeasurementActions(invalidate);
  const [dlg, setDlg] = useState<null | "schedule" | "done">(null);
  const [sf, setSf] = useState({ scheduledAt: "", technicianId: "", teamNotes: "" });
  const [df, setDf] = useState("");

  const openSchedule = () => {
    setSf({
      scheduledAt: toLocalInput(visit.scheduledAt),
      technicianId: visit.technician?.id ?? "",
      teamNotes: visit.teamNotes ?? "",
    });
    setDlg("schedule");
  };

  const deadlineTone =
    visit.daysToTechDeadline == null ? "" : visit.daysToTechDeadline < 0 ? "text-destructive" : visit.daysToTechDeadline <= 3 ? "text-warning" : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {showProject && visit.project && (
            <Link to={`/clientes-projetos/${visit.project.id}`} className="text-sm font-medium hover:underline">
              {visit.project.code} — {visit.project.name}
            </Link>
          )}
          {showProject && visit.project?.clientName && (
            <p className="text-xs text-muted-foreground">{visit.project.clientName}</p>
          )}
        </div>
        <Badge variant={visit.status === "DONE" ? "success" : visit.status === "SCHEDULED" ? "secondary" : visit.status === "CANCELLED" ? "muted" : "warning"}>
          {STATUS_LABEL[visit.status]}
        </Badge>
      </div>

      <div className="mt-2 space-y-1 text-sm">
        {visit.status === "REQUESTED" && (
          <>
            <p className="text-muted-foreground">
              Datas sugeridas: <span className="text-foreground">{visit.preferredDates.map((d) => fmtDate(d)).join(" · ") || "—"}</span>
              {visit.preferredPeriod ? ` · ${PERIOD_LABEL[visit.preferredPeriod] ?? visit.preferredPeriod}` : ""}
            </p>
            {visit.clientNotes && <p className="text-xs text-muted-foreground">“{visit.clientNotes}”</p>}
          </>
        )}
        {(visit.status === "SCHEDULED" || visit.status === "DONE") && (
          <p className="text-muted-foreground">
            {visit.status === "DONE" ? "Realizada em " : "Agendada para "}
            <span className="text-foreground">{fmtDateTime(visit.status === "DONE" ? visit.doneAt : visit.scheduledAt)}</span>
            {visit.technician ? ` · ${visit.technician.name}` : ""}
          </p>
        )}
        {visit.status === "DONE" && visit.techProjectDueAt && (
          <p className={deadlineTone}>
            Prazo do projeto técnico: {fmtDate(visit.techProjectDueAt)}
            {visit.daysToTechDeadline != null && (
              <> ({visit.daysToTechDeadline < 0 ? `${-visit.daysToTechDeadline}d atrasado` : `faltam ${visit.daysToTechDeadline}d`})</>
            )}
          </p>
        )}
        {visit.teamNotes && visit.status !== "REQUESTED" && <p className="text-xs text-muted-foreground">{visit.teamNotes}</p>}
      </div>

      {canManage && visit.status !== "CANCELLED" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {visit.status !== "DONE" && (
            <Button size="sm" variant="outline" onClick={openSchedule}>
              <CalendarCheck className="mr-1 h-4 w-4" /> {visit.status === "SCHEDULED" ? "Reagendar" : "Agendar"}
            </Button>
          )}
          {visit.status === "SCHEDULED" && (
            <Button size="sm" onClick={() => { setDf(visit.teamNotes ?? ""); setDlg("done"); }}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> Registrar conclusão
            </Button>
          )}
          {visit.status !== "DONE" && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancel.mutate(visit.id)}>
              Cancelar
            </Button>
          )}
        </div>
      )}

      <Dialog open={dlg === "schedule"} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Agendar medição</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Data e hora</Label>
              <Input type="datetime-local" value={sf.scheduledAt} onChange={(e) => setSf({ ...sf, scheduledAt: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Técnico</Label>
              <Select value={sf.technicianId || "NONE"} onValueChange={(v) => setSf({ ...sf, technicianId: v === "NONE" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">A definir</SelectItem>
                  {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Observações da equipe</Label>
              <Textarea rows={2} value={sf.teamNotes} onChange={(e) => setSf({ ...sf, teamNotes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Cancelar</Button>
            <Button
              disabled={schedule.isPending || !sf.scheduledAt}
              onClick={() => schedule.mutate({ id: visit.id, ...sf }, { onSuccess: () => setDlg(null) })}
            >
              {schedule.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "done"} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar conclusão da medição</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Isso inicia o prazo de <strong>12 dias</strong> para o projeto técnico.
          </p>
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea rows={3} value={df} onChange={(e) => setDf(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Cancelar</Button>
            <Button
              disabled={markDone.isPending}
              onClick={() => markDone.mutate({ id: visit.id, teamNotes: df }, { onSuccess: () => setDlg(null) })}
            >
              {markDone.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Concluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================ per-project panel ============================ */

export function MeasurementProjectPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["measurements", "project", projectId];
  const visits = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: MeasurementVisit[] }>(`/measurements/projects/${projectId}`) });
  const people = useQuery({ queryKey: ["org-people"], queryFn: () => apiGet<{ data: Person[] }>("/organization/people") });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const { create } = useMeasurementActions(invalidate);

  if (visits.isLoading) return <PageSkeleton />;
  const list = visits.data?.data ?? [];
  const hasOpen = list.some((v) => v.status === "REQUESTED" || v.status === "SCHEDULED");

  return (
    <div className="space-y-3">
      {canManage && !hasOpen && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => create.mutate({ projectId, scheduledAt: null, technicianId: null })} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ruler className="mr-2 h-4 w-4" />}
            Nova medição
          </Button>
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState title="Nenhuma medição" description="O cliente pode solicitar pelo portal, ou a equipe cria aqui." />
      ) : (
        list.map((v) => (
          <MeasurementCard key={v.id} visit={v} people={people.data?.data ?? []} canManage={canManage} invalidate={invalidate} showProject={false} />
        ))
      )}
    </div>
  );
}

/* ============================ global page ============================ */

export function MeasurementsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("organization.manage");
  const key = ["measurements", "all"];
  const visits = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: MeasurementVisit[] }>("/measurements") });
  const people = useQuery({ queryKey: ["org-people"], queryFn: () => apiGet<{ data: Person[] }>("/organization/people") });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const groups = useMemo(() => {
    const all = visits.data?.data ?? [];
    return {
      REQUESTED: all.filter((v) => v.status === "REQUESTED"),
      SCHEDULED: all.filter((v) => v.status === "SCHEDULED"),
      DONE: all.filter((v) => v.status === "DONE").sort((a, b) => (a.techProjectDueAt ?? "").localeCompare(b.techProjectDueAt ?? "")),
    };
  }, [visits.data]);

  if (visits.isLoading) return <PageSkeleton />;

  const section = (title: string, icon: React.ReactNode, list: MeasurementVisit[]) => (
    <Card>
      <CardHeader className="py-3"><CardTitle className="flex items-center gap-2 text-base">{icon} {title} ({list.length})</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {list.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">—</p>
        ) : (
          list.map((v) => (
            <MeasurementCard key={v.id} visit={v} people={people.data?.data ?? []} canManage={canManage} invalidate={invalidate} />
          ))
        )}
      </CardContent>
    </Card>
  );

  const total = (visits.data?.data ?? []).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Medições" description="Solicitações de medição, agendamento e prazo do projeto técnico (12 dias)." />
      {total === 0 ? (
        <EmptyState title="Nenhuma medição" description="Quando um cliente solicitar a medição pelo portal, aparece aqui." />
      ) : (
        <div className="space-y-4">
          {section("Solicitadas", <Clock className="h-4 w-4" />, groups.REQUESTED)}
          {section("Agendadas", <CalendarCheck className="h-4 w-4" />, groups.SCHEDULED)}
          {section("Concluídas", <CheckCircle2 className="h-4 w-4" />, groups.DONE)}
        </div>
      )}
    </div>
  );
}
