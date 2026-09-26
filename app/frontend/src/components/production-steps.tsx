import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronUp, Clock, Lock, Play, RotateCcw, SkipForward, Unlock } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { apiGet, apiPatch } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { cn, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FileAttachments } from "@/components/file-attachments";

export type StepStatus = "PENDING" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "SKIPPED";
export type ProductionStepRow = {
  id: string;
  step: string;
  label: string;
  position: number;
  status: StepStatus;
  statusLabel: string;
  responsible: { id: string; name: string } | null;
  startedAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  notes: string | null;
  blockedReason: string | null;
  daysLate: number;
  dueSoon: boolean;
  fileCount: number;
  project: { id: string; code: string; name: string; clientName: string | null };
};

const VARIANT: Record<StepStatus, "muted" | "default" | "danger" | "success" | "secondary"> = {
  PENDING: "muted",
  IN_PROGRESS: "default",
  BLOCKED: "danger",
  DONE: "success",
  SKIPPED: "secondary",
};

type Action = "START" | "COMPLETE" | "BLOCK" | "UNBLOCK" | "SKIP" | "REOPEN";

function DueInfo({ s }: { s: ProductionStepRow }) {
  if (s.status === "DONE") return <span className="text-success">concluída {formatDate(s.completedAt)}</span>;
  if (s.status === "SKIPPED") return <span>—</span>;
  if (!s.dueAt) return <span>sem prazo</span>;
  if (s.daysLate > 0) return <span className="font-medium text-destructive">venceu {formatDate(s.dueAt)} · {s.daysLate} dia(s) de atraso</span>;
  return <span className={cn(s.dueSoon && "font-medium text-warning")}>prazo {formatDate(s.dueAt)}{s.dueSoon ? " · vence em breve" : ""}</span>;
}

/** Etapas do pedido na fábrica (§23/§24), no detalhe do projeto. */
export function ProductionStepsCard({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ["production", "steps", projectId];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: ProductionStepRow[] }>(`/production/projects/${projectId}/steps`) });
  const people = useQuery({ queryKey: ["org-people"], queryFn: () => apiGet<{ data: { id: string; name: string }[] }>("/organization/people"), enabled: canEdit });
  const [open, setOpen] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    // a esteira macro pode ter andado junto
    qc.invalidateQueries({ queryKey: ["production"] });
  };
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiPatch<{ message: string }>(`/production/steps/${id}`, body),
    onSuccess: (r) => {
      toast.success(r.message);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível atualizar a etapa")),
  });
  const act = (s: ProductionStepRow, action: Action) => {
    if (action === "BLOCK") {
      const reason = prompt(`Por que "${s.label}" está bloqueada?`);
      if (!reason) return;
      return patch.mutate({ id: s.id, body: { action, reason } });
    }
    if (action === "SKIP" && !confirm(`Marcar "${s.label}" como não se aplica a este pedido?`)) return;
    patch.mutate({ id: s.id, body: { action } });
  };

  const steps = q.data?.data ?? [];
  const done = steps.filter((s) => s.status === "DONE" || s.status === "SKIPPED").length;

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Etapas na fábrica</span>
          {steps.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {done}/{steps.length} concluídas
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {q.isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando etapas...</p>
        ) : q.isError ? (
          <p className="text-xs text-destructive">{errorMessage(q.error, "Falha ao carregar as etapas")}</p>
        ) : (
          steps.map((s) => {
            const expanded = open === s.id;
            return (
              <div key={s.id} className={cn("rounded-lg border", s.status === "BLOCKED" && "border-destructive/50 bg-destructive/5", s.daysLate > 0 && s.status !== "BLOCKED" && "border-warning/60")}>
                <button type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left" onClick={() => setOpen(expanded ? null : s.id)}>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {s.position + 1}. {s.label} <Badge variant={VARIANT[s.status]}>{s.statusLabel}</Badge>
                      {s.fileCount > 0 && <span className="text-xs font-normal text-muted-foreground">{s.fileCount} anexo(s)</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {s.responsible ? `${s.responsible.name} · ` : "sem responsável · "}
                      <DueInfo s={s} />
                    </span>
                    {s.status === "BLOCKED" && s.blockedReason && <span className="block text-xs text-destructive">Bloqueio: {s.blockedReason}</span>}
                  </span>
                  {expanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                </button>
                {expanded && (
                  <StepDetail
                    s={s}
                    canEdit={canEdit}
                    people={people.data?.data ?? []}
                    busy={patch.isPending}
                    onAct={(a) => act(s, a)}
                    onSave={(body) => patch.mutate({ id: s.id, body })}
                    onFiles={invalidate}
                  />
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function StepDetail({
  s,
  canEdit,
  people,
  busy,
  onAct,
  onSave,
  onFiles,
}: {
  s: ProductionStepRow;
  canEdit: boolean;
  people: { id: string; name: string }[];
  busy: boolean;
  onAct: (a: Action) => void;
  onSave: (body: Record<string, unknown>) => void;
  onFiles: () => void;
}) {
  const [due, setDue] = useState(s.dueAt ? s.dueAt.slice(0, 10) : "");
  const [notes, setNotes] = useState(s.notes ?? "");
  const btn = (a: Action, label: string, Icon: typeof Play, variant: "default" | "outline" | "ghost" = "outline") => (
    <Button size="sm" variant={variant} disabled={busy} onClick={() => onAct(a)}>
      <Icon className="h-4 w-4" /> {label}
    </Button>
  );
  return (
    <div className="space-y-3 border-t p-3">
      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <span>Início: {s.startedAt ? formatDate(s.startedAt, true) : "—"}</span>
        <span>Prazo: {s.dueAt ? formatDate(s.dueAt) : "—"}</span>
        <span>Conclusão: {s.completedAt ? formatDate(s.completedAt, true) : "—"}</span>
      </div>
      {canEdit && (
        <>
          <div className="flex flex-wrap gap-2">
            {s.status === "PENDING" && btn("START", "Iniciar", Play, "default")}
            {(s.status === "PENDING" || s.status === "IN_PROGRESS") && btn("COMPLETE", "Concluir", CheckCircle2, s.status === "IN_PROGRESS" ? "default" : "outline")}
            {(s.status === "PENDING" || s.status === "IN_PROGRESS") && btn("BLOCK", "Bloquear", Lock)}
            {s.status === "BLOCKED" && btn("UNBLOCK", "Desbloquear", Unlock, "default")}
            {s.status === "PENDING" && btn("SKIP", "Não se aplica", SkipForward, "ghost")}
            {(s.status === "DONE" || s.status === "SKIPPED") && btn("REOPEN", "Reabrir", RotateCcw, "ghost")}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Responsável</Label>
              <Select value={s.responsible?.id ?? "NONE"} onValueChange={(v) => onSave({ responsibleId: v === "NONE" ? null : v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Sem responsável</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Prazo</Label>
              <div className="flex gap-2">
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                {due !== (s.dueAt ? s.dueAt.slice(0, 10) : "") && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onSave({ dueAt: due ? `${due}T18:00:00` : null })}>
                    Salvar
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            {notes !== (s.notes ?? "") && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onSave({ notes })}>
                Salvar observação
              </Button>
            )}
          </div>
        </>
      )}
      {!canEdit && s.notes && <p className="whitespace-pre-line text-sm">{s.notes}</p>}
      <div className="space-y-1">
        <Label className="text-xs">Anexos</Label>
        <FileAttachments entity="ProductionStep" entityId={s.id} canWrite={canEdit} onChange={onFiles} />
      </div>
    </div>
  );
}

/** Painel da fábrica: etapas atrasadas, bloqueadas e vencendo, de todos os pedidos. */
export function FactoryStepsOverview() {
  const [filter, setFilter] = useState<"late" | "blocked" | "due" | "open">("late");
  const q = useQuery({
    queryKey: ["production", "steps-overview", filter],
    queryFn: () => apiGet<{ data: { counts: { late: number; blocked: number; dueSoon: number }; steps: ProductionStepRow[] } }>("/production/steps/overview", { filter }),
  });
  const c = q.data?.data.counts;
  const tab = (key: typeof filter, label: string, n: number | undefined, Icon: typeof Clock, tone: string) => (
    <button
      type="button"
      onClick={() => setFilter(key)}
      className={cn("flex flex-1 items-center gap-3 rounded-lg border p-3 text-left transition", filter === key ? "border-primary bg-primary/5" : "hover:bg-muted/50")}
    >
      <Icon className={cn("h-5 w-5", tone)} />
      <span>
        <span className="block text-xl font-semibold">{n ?? "—"}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </span>
    </button>
  );
  const steps = q.data?.data.steps ?? [];
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-base">Prazos das etapas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          {tab("late", "Atrasadas", c?.late, AlertTriangle, "text-destructive")}
          {tab("blocked", "Bloqueadas", c?.blocked, Ban, "text-destructive")}
          {tab("due", "Vencem em até 1 dia", c?.dueSoon, Clock, "text-warning")}
          {tab("open", "Em andamento", undefined, Play, "text-primary")}
        </div>
        {q.isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando...</p>
        ) : steps.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma etapa nesta situação.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {steps.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span className="min-w-0">
                  <Link to={`/clientes-projetos/${s.project.id}`} className="font-medium hover:underline">
                    {s.project.code} — {s.project.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {s.label} · {s.responsible?.name ?? "sem responsável"} · <DueInfo s={s} />
                  </span>
                  {s.blockedReason && s.status === "BLOCKED" && <span className="block text-xs text-destructive">Bloqueio: {s.blockedReason}</span>}
                </span>
                <Badge variant={VARIANT[s.status]}>{s.statusLabel}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
