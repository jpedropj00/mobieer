import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarClock, CheckCircle2, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Schedule = {
  stage: "SEM_DATAS" | "AGUARDANDO_CLIENTE" | "AGENDADA" | "CONFIRMADA" | "REMARCAR";
  scheduledLabel: string | null;
  optionsSentAt: string | null;
  clientConfirmedAt: string | null;
  reminderSentAt: string | null;
  rescheduleRequestedAt: string | null;
  options: { id: string; startsAt: string; period: string | null; label: string; chosen: boolean }[];
};

const STAGE: Record<Schedule["stage"], { label: string; variant: "muted" | "warning" | "secondary" | "success" }> = {
  SEM_DATAS: { label: "Enviar datas", variant: "warning" },
  AGUARDANDO_CLIENTE: { label: "Cliente escolhendo", variant: "secondary" },
  AGENDADA: { label: "Visita marcada", variant: "secondary" },
  CONFIRMADA: { label: "Confirmada pelo cliente", variant: "success" },
  REMARCAR: { label: "Pediu para remarcar", variant: "warning" },
};

const toLocalInput = (offsetDays: number, hour = 9) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** Badge compacto do agendamento, para listas. */
export function AssistanceScheduleBadge({ stage }: { stage: Schedule["stage"] }) {
  const s = STAGE[stage];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/**
 * Painel da equipe: propor datas ao cliente, marcar direto (combinado por
 * telefone) e registrar a confirmação. O pedido em si é sempre do cliente.
 */
export function AssistanceSchedulePanel({ ticketId, canManage }: { ticketId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["assistance", "schedule", ticketId];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: Schedule }>(`/assistance/${ticketId}/schedule`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["business-assistances"] });
    qc.invalidateQueries({ queryKey: ["store", "pipeline"] });
  };

  const [options, setOptions] = useState<{ startsAt: string; period: string }[]>([
    { startsAt: toLocalInput(1), period: "MANHA" },
    { startsAt: toLocalInput(2, 14), period: "TARDE" },
  ]);
  const [direct, setDirect] = useState({ startsAt: toLocalInput(1), period: "MANHA" });
  const [mode, setMode] = useState<"options" | "direct">("options");

  const propose = useMutation({
    mutationFn: () =>
      apiPost<{ message?: string }>(`/assistance/${ticketId}/options`, {
        options: options.map((o) => ({ startsAt: new Date(o.startsAt).toISOString(), period: o.period || null })),
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Datas enviadas ao cliente");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível enviar as datas")),
  });
  const schedule = useMutation({
    mutationFn: () =>
      apiPost<{ message?: string }>(`/assistance/${ticketId}/schedule`, {
        startsAt: new Date(direct.startsAt).toISOString(),
        period: direct.period || null,
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Visita agendada");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível agendar")),
  });
  const confirm = useMutation({
    mutationFn: () => apiPost(`/assistance/${ticketId}/confirm`),
    onSuccess: () => {
      toast.success("Confirmação registrada");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível confirmar")),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const s = q.data?.data;
  if (!s) return <p className="text-sm text-destructive">{errorMessage(q.error, "Não foi possível carregar")}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <AssistanceScheduleBadge stage={s.stage} />
        {s.scheduledLabel && <span className="text-sm">Visita: <strong>{s.scheduledLabel}</strong></span>}
        {s.reminderSentAt && <span className="text-xs text-muted-foreground">lembrete enviado</span>}
      </div>

      {s.options.length > 0 && (
        <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Datas enviadas ao cliente</p>
          {s.options.map((o) => (
            <p key={o.id} className="flex items-center gap-2">
              {o.chosen ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <CalendarClock className="h-4 w-4 text-muted-foreground" />}
              {o.label}
              {o.chosen && <span className="text-xs text-primary">escolhida</span>}
            </p>
          ))}
        </div>
      )}

      {s.stage === "AGENDADA" && canManage && (
        <Button size="sm" variant="outline" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
          <CalendarCheck className="mr-2 h-4 w-4" /> Cliente confirmou (por telefone)
        </Button>
      )}

      {canManage && s.stage !== "CONFIRMADA" && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs">
            <button type="button" className={`flex-1 rounded-md px-2 py-1 ${mode === "options" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setMode("options")}>
              Enviar datas ao cliente
            </button>
            <button type="button" className={`flex-1 rounded-md px-2 py-1 ${mode === "direct" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setMode("direct")}>
              Marcar direto
            </button>
          </div>

          {mode === "options" ? (
            <>
              {options.map((o, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Data e hora</Label>
                    <Input
                      type="datetime-local"
                      className="w-56"
                      value={o.startsAt}
                      onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, startsAt: e.target.value } : x)))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Período</Label>
                    <Select value={o.period} onValueChange={(v) => setOptions(options.map((x, j) => (j === i ? { ...x, period: v } : x)))}>
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MANHA">Manhã</SelectItem>
                        <SelectItem value="TARDE">Tarde</SelectItem>
                        <SelectItem value="QUALQUER">Hora marcada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {options.length > 1 && (
                    <Button size="icon" variant="ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                {options.length < 6 && (
                  <Button size="sm" variant="ghost" onClick={() => setOptions([...options, { startsAt: toLocalInput(options.length + 1), period: "MANHA" }])}>
                    <Plus className="mr-1 h-4 w-4" /> Data
                  </Button>
                )}
                <Button size="sm" disabled={propose.isPending} onClick={() => propose.mutate()}>
                  {propose.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Enviar ao cliente
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                O cliente escolhe pelo portal e recebe um lembrete no WhatsApp na véspera para confirmar.
              </p>
            </>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Data e hora</Label>
                <Input type="datetime-local" className="w-56" value={direct.startsAt} onChange={(e) => setDirect({ ...direct, startsAt: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Período</Label>
                <Select value={direct.period} onValueChange={(v) => setDirect({ ...direct, period: v })}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANHA">Manhã</SelectItem>
                    <SelectItem value="TARDE">Tarde</SelectItem>
                    <SelectItem value="QUALQUER">Hora marcada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" disabled={schedule.isPending} onClick={() => schedule.mutate()}>
                {schedule.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Agendar
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Abre o painel de agendamento num diálogo (usado na lista de assistências). */
export function AssistanceScheduleDialog({
  ticket,
  canManage,
  onClose,
}: {
  ticket: { id: string; number: string; title: string; clientName: string } | null;
  canManage: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(ticket)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {ticket?.number} — {ticket?.title}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{ticket?.clientName}</p>
        </DialogHeader>
        {ticket && <AssistanceSchedulePanel ticketId={ticket.id} canManage={canManage} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
