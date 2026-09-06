import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckCircle2, Clock, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/utils";
import { portalGet, portalPatch, portalPost } from "@/services/portal-api";

type Visit = {
  id: string;
  status: "REQUESTED" | "SCHEDULED" | "DONE" | "CANCELLED";
  preferredDates: string[];
  preferredPeriod: string | null;
  clientNotes: string | null;
  scheduledAt: string | null;
  doneAt: string | null;
  techProjectDueAt: string | null;
  technician: { id: string; name: string } | null;
};

const PERIOD_LABEL: Record<string, string> = { MANHA: "Manhã", TARDE: "Tarde", QUALQUER: "Qualquer horário" };
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const fmtDateTime = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const todayISO = () => new Date().toISOString().slice(0, 10);

export function PortalMeasurement({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const key = ["portal", "measurement", projectId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => portalGet<{ data: Visit | null }>(`/projects/${projectId}/measurement`),
  });

  const [form, setForm] = useState({ d1: "", d2: "", d3: "", period: "QUALQUER", notes: "" });
  const visit = data?.data ?? null;
  const editing = !visit || visit.status === "REQUESTED";

  useEffect(() => {
    if (visit?.status === "REQUESTED") {
      setForm({
        d1: visit.preferredDates[0] ?? "",
        d2: visit.preferredDates[1] ?? "",
        d3: visit.preferredDates[2] ?? "",
        period: visit.preferredPeriod ?? "QUALQUER",
        notes: visit.clientNotes ?? "",
      });
    }
  }, [visit?.id, visit?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => {
    const preferredDates = [form.d1, form.d2, form.d3].filter(Boolean);
    return { preferredDates, preferredPeriod: form.period, clientNotes: form.notes || null };
  };
  const request = useMutation({
    mutationFn: () => portalPost(`/projects/${projectId}/measurement`, body()),
    onSuccess: () => { toast.success("Solicitação enviada!"); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao enviar")),
  });
  const update = useMutation({
    mutationFn: () => portalPatch(`/measurement/${visit!.id}`, body()),
    onSuccess: () => { toast.success("Solicitação atualizada"); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao atualizar")),
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const datesCount = [form.d1, form.d2, form.d3].filter(Boolean).length;

  return (
    <div className="space-y-4">
      {visit && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>Medição</span>
              <Badge variant={visit.status === "DONE" ? "success" : visit.status === "SCHEDULED" ? "secondary" : visit.status === "CANCELLED" ? "muted" : "warning"}>
                {visit.status === "DONE" ? "Concluída" : visit.status === "SCHEDULED" ? "Agendada" : visit.status === "CANCELLED" ? "Cancelada" : "Aguardando confirmação"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {visit.status === "SCHEDULED" && (
              <p className="flex items-center gap-2"><CalendarCheck className="h-4 w-4 text-primary" />
                Sua medição está agendada para <strong>{fmtDateTime(visit.scheduledAt)}</strong>
                {visit.technician ? ` com ${visit.technician.name}` : ""}.
              </p>
            )}
            {visit.status === "DONE" && (
              <>
                <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" />
                  Medição realizada em <strong>{fmtDate(visit.doneAt)}</strong>.
                </p>
                {visit.techProjectDueAt && (
                  <p className="text-muted-foreground">
                    Previsão de entrega do projeto técnico: <strong className="text-foreground">{fmtDate(visit.techProjectDueAt)}</strong> (até 12 dias).
                  </p>
                )}
              </>
            )}
            {visit.status === "REQUESTED" && (
              <p className="flex items-center gap-2 text-muted-foreground"><Clock className="h-4 w-4" />
                Recebemos seu pedido. A equipe vai confirmar a melhor data entre as que você sugeriu.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {editing && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{visit ? "Ajustar solicitação" : "Solicitar medição"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Sugira até 3 datas de sua preferência. A equipe confirma uma delas.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Data 1</Label>
                <Input type="date" min={todayISO()} value={form.d1} onChange={(e) => setForm({ ...form, d1: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Data 2 (opcional)</Label>
                <Input type="date" min={todayISO()} value={form.d2} onChange={(e) => setForm({ ...form, d2: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Data 3 (opcional)</Label>
                <Input type="date" min={todayISO()} value={form.d3} onChange={(e) => setForm({ ...form, d3: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Período preferido</Label>
              <Select value={form.period} onValueChange={(v) => setForm({ ...form, period: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PERIOD_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Observações (portaria, interfone, acesso…)</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button
              disabled={datesCount === 0 || request.isPending || update.isPending}
              onClick={() => (visit ? update.mutate() : request.mutate())}
            >
              {(request.isPending || update.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {visit ? "Atualizar" : "Enviar solicitação"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
