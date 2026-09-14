import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarDays, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiDelete, apiGet, apiPost } from "@/services/api";
import type { Holiday, HolidayScope } from "@/types";
import { cn, errorMessage } from "@/lib/utils";

const SCOPE_LABEL: Record<HolidayScope, string> = {
  NACIONAL: "Nacional",
  ESTADUAL: "Ceará",
  MUNICIPAL: "Fortaleza",
  EMPRESA: "Empresa",
};
const SCOPE_VARIANT: Record<HolidayScope, "secondary" | "success" | "warning" | "muted"> = {
  NACIONAL: "secondary",
  ESTADUAL: "success",
  MUNICIPAL: "warning",
  EMPRESA: "muted",
};
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Formata aaaa-mm-dd sem passar por fuso (Date puro escorregaria um dia). */
function fmtDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} · ${WEEKDAYS[dt.getUTCDay()]}`;
}
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Feriados nacionais, do Ceará e de Fortaleza (calculados) + recessos da casa.
 * A equipe é avisada automaticamente 7 dias antes de cada um.
 */
export function HolidaysTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: todayIso(), name: "", scope: "EMPRESA" as HolidayScope, optional: false, notes: "" });

  const key = ["hr", "holidays", year];
  const holidays = useQuery({
    queryKey: key,
    queryFn: () => apiGet<{ data: { year: number; holidays: Holiday[] } }>("/hr/holidays", { year }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["hr", "holidays"] });

  const create = useMutation({
    mutationFn: () => apiPost("/hr/holidays", { ...form, notes: form.notes || null }),
    onSuccess: () => {
      toast.success("Feriado cadastrado");
      setOpen(false);
      setForm({ date: todayIso(), name: "", scope: "EMPRESA", optional: false, notes: "" });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao cadastrar")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/hr/holidays/${id}`),
    onSuccess: () => { toast.success("Feriado removido"); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });

  const notify = useMutation({
    mutationFn: () => apiPost<{ data: { holidays: number; notifications: number } }>("/hr/holidays/notify", { days: 7 }),
    onSuccess: (r) => {
      toast.success(
        r.data.holidays
          ? `${r.data.holidays} feriado(s) avisado(s) — ${r.data.notifications} notificação(ões)`
          : "Nenhum feriado novo nos próximos 7 dias"
      );
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao disparar avisos")),
  });

  const list = holidays.data?.data.holidays ?? [];
  const today = todayIso();
  const next = useMemo(() => list.filter((h) => h.date >= today).slice(0, 4), [list, today]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setYear((y) => y - 1)}>←</Button>
          <span className="min-w-16 text-center text-sm font-medium">{year}</span>
          <Button size="sm" variant="outline" onClick={() => setYear((y) => y + 1)}>→</Button>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => notify.mutate()} disabled={notify.isPending}>
              {notify.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BellRing className="mr-2 h-4 w-4" />}
              Avisar equipe agora
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Recesso da empresa
            </Button>
          </div>
        )}
      </div>

      {next.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" /> Próximos
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {next.map((h) => (
              <div key={`${h.date}-${h.name}`} className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{fmtDay(h.date)}</p>
                <p className="text-xs text-muted-foreground">{h.name}</p>
                <div className="mt-1 flex gap-1">
                  <Badge variant={SCOPE_VARIANT[h.scope]}>{SCOPE_LABEL[h.scope]}</Badge>
                  {h.optional && <Badge variant="muted">facultativo</Badge>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Feriados nacionais, do Ceará e de Fortaleza são calculados automaticamente (inclusive os móveis, que dependem da Páscoa).
        A equipe recebe um aviso 7 dias antes de cada um. Confira a lista municipal com o RH — ela muda por lei local.
      </p>

      {holidays.isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="space-y-1">
          {list.map((h) => {
            const past = h.date < today;
            return (
              <div
                key={`${h.date}-${h.name}`}
                className={cn("flex items-center gap-3 rounded-lg border border-border p-2.5", past && "opacity-50")}
              >
                <span className="w-36 shrink-0 text-sm font-medium tabular-nums">{fmtDay(h.date)}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{h.name}</span>
                <Badge variant={SCOPE_VARIANT[h.scope]}>{SCOPE_LABEL[h.scope]}</Badge>
                {h.optional && <Badge variant="muted">facultativo</Badge>}
                {h.source === "EMPRESA" && canManage && h.id && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove.mutate(h.id!)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recesso / feriado da empresa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Recesso de fim de ano" />
            </div>
            <div className="space-y-2">
              <Label>Abrangência</Label>
              <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as HolidayScope })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(SCOPE_LABEL) as [HolidayScope, string][]).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="opt" checked={form.optional} onCheckedChange={(v) => setForm({ ...form, optional: v })} />
              <Label htmlFor="opt">Ponto facultativo</Label>
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cadastrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
