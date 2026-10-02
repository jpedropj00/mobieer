import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, FileDown, FolderUp, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiOpen, apiPost, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Data = { start: string; end: string; ambientes: string; address: string; stages: string[][]; highlights: string[]; obs: string[]; closing: string[]; extra: string[] };
type Week = { from: string; to: string; businessDays: number; label: string };
type Computed = { weeks: Week[]; inspection: string; weekends: number };

const br = (iso: string) => iso.split("-").reverse().join("/");
const toLines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

/** Cronograma de montagem que vai para o cliente (modelo da planilha da loja). */
export function InstallationSchedulePanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["installation-schedule", projectId];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: { saved: boolean; data: Data } & Computed }>(`/production/projects/${projectId}/installation-schedule`) });
  const [form, setForm] = useState<Data | null>(null);
  // texto livre de cada semana e dos rodapés, uma linha por item
  const [stageText, setStageText] = useState<string[]>([]);
  const [texts, setTexts] = useState({ highlights: "", obs: "", closing: "", extra: "" });

  useEffect(() => {
    const d = q.data?.data.data;
    if (!d || form) return;
    setForm(d);
    setStageText(d.stages.map((s) => s.join("\n")));
    setTexts({ highlights: d.highlights.join("\n"), obs: d.obs.join("\n"), closing: d.closing.join("\n"), extra: d.extra.join("\n") });
  }, [q.data, form]);

  const validRange = form && form.start && form.end && form.end >= form.start;
  const weeks = useQuery({
    queryKey: ["installation-schedule-weeks", projectId, form?.start, form?.end],
    queryFn: () => apiGet<{ data: Computed }>(`/production/projects/${projectId}/installation-schedule/weeks`, { start: form!.start, end: form!.end }),
    enabled: Boolean(validRange),
    placeholderData: (prev) => prev,
  });
  const c = weeks.data?.data;

  const body = (): Data => ({
    ...form!,
    stages: (c?.weeks ?? []).map((_, i) => toLines(stageText[i] ?? "")),
    highlights: toLines(texts.highlights),
    obs: toLines(texts.obs),
    closing: toLines(texts.closing),
    extra: toLines(texts.extra),
  });

  const save = useMutation({
    mutationFn: () => apiPut<{ message?: string }>(`/production/projects/${projectId}/installation-schedule`, body()),
    onSuccess: (r) => { toast.success(r.message ?? "Cronograma salvo"); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar")),
  });
  const pdf = useMutation({
    mutationFn: async () => {
      if (canManage) await apiPut(`/production/projects/${projectId}/installation-schedule`, body());
      await apiOpen(`/production/projects/${projectId}/installation-schedule.pdf`);
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível gerar o PDF")),
  });
  const publish = useMutation({
    mutationFn: async () => {
      await apiPut(`/production/projects/${projectId}/installation-schedule`, body());
      return apiPost<{ message?: string }>(`/production/projects/${projectId}/installation-schedule/publish`, {});
    },
    onSuccess: (r) => toast.success(r.message ?? "Cronograma salvo nos documentos"),
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar nos documentos")),
  });

  if (q.isLoading || !form) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const worked = (c?.weeks ?? []).reduce((s, w) => s + w.businessDays, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2"><CalendarRange className="h-4 w-4" /> Cronograma de montagem</span>
            {!q.data?.data.saved && <Badge variant="warning">Sugestão — ainda não salvo</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Início da montagem</Label>
              <Input type="date" disabled={!canManage} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fim da montagem</Label>
              <Input type="date" disabled={!canManage} value={form.end} min={form.start} onChange={(e) => setForm({ ...form, end: e.target.value })} />
            </div>
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs">Ambientes</Label>
              <Input disabled={!canManage} value={form.ambientes} onChange={(e) => setForm({ ...form, ambientes: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Endereço da obra</Label>
            <Input disabled={!canManage} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          {!validRange ? (
            <p className="text-sm text-destructive">O fim precisa ser depois do início.</p>
          ) : c ? (
            <p className="text-xs text-muted-foreground">
              {c.weeks.length} {c.weeks.length === 1 ? "semana" : "semanas"} · {worked} dias úteis · {c.weekends} {c.weekends === 1 ? "final" : "finais"} de semana · vistoria final em {br(c.inspection)}. Feriados não contam como dia útil.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {c && validRange && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {c.weeks.map((w, i) => (
            <Card key={w.from}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  Etapa {i + 1}
                  <span className="block text-xs font-normal text-muted-foreground">{w.label.toLowerCase()}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  rows={4}
                  disabled={!canManage}
                  placeholder={"O que será instalado — uma linha por item\nEx.: Módulos inferiores e superiores da cozinha"}
                  value={stageText[i] ?? ""}
                  onChange={(e) => setStageText((t) => { const n = [...t]; n[i] = e.target.value; return n; })}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Textos do cronograma (uma linha por aviso)</CardTitle></CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {([
            ["highlights", "Avisos em destaque (vermelho)"],
            ["obs", "OBS ao lado da legenda (OBS1, OBS2…)"],
            ["closing", "Faixa amarela (limpeza, vistoria)"],
            ["extra", "Observações adicionais (obs 01, obs 02…)"],
          ] as const).map(([k, label]) => (
            <div key={k} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <Textarea rows={4} disabled={!canManage} value={texts[k]} onChange={(e) => setTexts({ ...texts, [k]: e.target.value })} />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        {canManage && (
          <Button variant="outline" disabled={!validRange || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salvar
          </Button>
        )}
        <Button variant="outline" disabled={!validRange || pdf.isPending} onClick={() => pdf.mutate()}>
          {pdf.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />} Gerar PDF
        </Button>
        {canManage && (
          <Button disabled={!validRange || publish.isPending} onClick={() => publish.mutate()} title="Guarda o PDF nos documentos do projeto; o cliente vê no portal">
            {publish.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderUp className="mr-2 h-4 w-4" />} Salvar nos documentos do projeto
          </Button>
        )}
      </div>
    </div>
  );
}
