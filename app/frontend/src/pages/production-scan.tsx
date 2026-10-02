import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Printer, ScanBarcode, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiGet, apiObjectUrl, apiPost } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { cn, errorMessage } from "@/lib/utils";
import { CameraScanner } from "@/components/camera-scanner";

type CheckItem = {
  id: string;
  code: string | null;
  descricao: string;
  ambiente: string | null;
  modulo: string | null;
  medidas: string | null;
  material: string | null;
  quantidade: number;
  status: "PENDING" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  sectorLabel: string | null;
  position: number;
};
type Summary = { total: number; done: number; missing: number; percent: number };
type Project = { id: string; code: string; name: string };
type Checklist = { project: Project; summary: Summary; items: CheckItem[] };
type ScanResult = { result: "OK" | "ALREADY"; item: CheckItem; project: Project; summary: Summary };
type Feedback = { tone: "ok" | "warn" | "error"; title: string; detail: string; at: number };

/** Abre o PDF de etiquetas numa aba nova (o download precisa do token, por isso passa pelo fetch). */
export async function openLabels(projectId: string, format: "a4" | "termica", pending = false) {
  const tab = window.open("", "_blank");
  try {
    const url = await apiObjectUrl(`/production/projects/${projectId}/labels.pdf?format=${format}${pending ? "&pending=1" : ""}`);
    if (tab) tab.location.href = url;
    else {
      // pop-up bloqueado: baixa o arquivo sem tirar o operador da tela
      const a = document.createElement("a");
      a.href = url;
      a.download = `etiquetas-${format}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch (e) {
    tab?.close();
    toast.error(errorMessage(e, "Não foi possível gerar as etiquetas"));
  }
}

function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.4));
    osc.onended = () => ctx.close();
  } catch {
    /* sem áudio: o aviso na tela basta */
  }
}

const TONE: Record<Feedback["tone"], string> = {
  ok: "border-success/40 bg-success/10 text-success",
  warn: "border-warning/40 bg-warning/10 text-warning",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** Leitor de etiquetas: o leitor de código de barras digita o código e dá Enter; a tela dá baixa no item. */
export function ProductionScanPage() {
  const { can } = useAuth();
  const canScan = can("organization.manage");
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const projectId = params.get("projeto");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"done" | "advance">("done");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [log, setLog] = useState<Feedback[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const list = useQuery({
    queryKey: ["production-checklist", projectId],
    queryFn: () => apiGet<{ data: Checklist }>(`/production/projects/${projectId}/checklist`),
    enabled: Boolean(projectId),
  });

  const push = (f: Feedback) => {
    setFeedback(f);
    setLog((l) => [f, ...l].slice(0, 8));
    beep(f.tone === "ok");
  };

  const scan = useMutation({
    mutationFn: (value: string) => apiPost<{ data: ScanResult; message?: string }>("/production/scan", { code: value, mode }),
    onSuccess: (r) => {
      const d = r.data;
      const where = [d.item.ambiente, d.item.modulo].filter(Boolean).join(" · ");
      push({
        tone: d.result === "OK" ? "ok" : "warn",
        title: r.message ?? "Leitura registrada",
        detail: `${d.item.descricao}${where ? ` — ${where}` : ""} · projeto ${d.project.code} (${d.summary.done}/${d.summary.total})`,
        at: Date.now(),
      });
      if (d.project.id !== projectId) setParams({ projeto: d.project.id }, { replace: true });
      qc.invalidateQueries({ queryKey: ["production-checklist", d.project.id] });
    },
    onError: (e, value) => push({ tone: "error", title: errorMessage(e, "Leitura não registrada"), detail: `Código lido: ${value}`, at: Date.now() }),
    onSettled: () => {
      setCode("");
      input.current?.focus();
    },
  });

  useEffect(() => {
    input.current?.focus();
  }, []);

  const d = list.data?.data;
  const items = (d?.items ?? []).filter((i) => i.status !== "CANCELLED" && (!onlyMissing || i.status !== "DONE"));

  return (
    <div className="space-y-6">
      <PageHeader title="Leitor de etiquetas" description="Leia o código de barras da etiqueta — com o leitor, pela câmera do celular ou digitando — para dar baixa no item. O que ficar sem baixa aparece em vermelho na conferência." />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim() && !scan.isPending) scan.mutate(code.trim());
            }}
          >
            <div className="min-w-[240px] flex-1">
              <label htmlFor="scan-code" className="mb-1 block text-xs text-muted-foreground">Código da etiqueta</label>
              <div className="relative">
                <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="scan-code"
                  ref={input}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={!canScan}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={canScan ? "Aponte o leitor para a etiqueta" : "Seu perfil não pode dar baixa"}
                  className="h-12 pl-11 text-lg tabular-nums"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">O que a leitura faz</label>
              <Select value={mode} onValueChange={(v) => setMode(v as "done" | "advance")}>
                <SelectTrigger className="h-12 w-[230px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="done">Dar baixa (item pronto)</SelectItem>
                  <SelectItem value="advance">Concluir o setor e avançar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="h-12" disabled={!canScan || !code.trim() || scan.isPending}>Registrar</Button>
          </form>

          {/* celular/tablet: lê a etiqueta pela câmera, uma atrás da outra */}
          <CameraScanner disabled={!canScan} onCode={(value) => { if (!scan.isPending) scan.mutate(value); }} />

          {feedback && (
            <div className={cn("flex items-start gap-3 rounded-lg border p-4", TONE[feedback.tone])} role="status" aria-live="polite">
              {feedback.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" /> : feedback.tone === "warn" ? <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" /> : <XCircle className="mt-0.5 h-6 w-6 shrink-0" />}
              <div>
                <p className="text-base font-semibold">{feedback.title}</p>
                <p className="text-sm text-foreground">{feedback.detail}</p>
              </div>
            </div>
          )}
          {log.length > 1 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Últimas leituras</p>
              {log.slice(1).map((l) => (
                <p key={l.at} className="text-xs text-muted-foreground">
                  <span className={l.tone === "ok" ? "text-success" : l.tone === "warn" ? "text-warning" : "text-destructive"}>●</span> {l.title} — {l.detail}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {d && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>
                Conferência — {d.project.code} · {d.project.name}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {d.summary.missing > 0 ? <Badge variant="danger">{d.summary.missing} sem baixa</Badge> : d.summary.total > 0 && <Badge variant="success">Tudo com baixa</Badge>}
                <span className="text-xs font-normal text-muted-foreground">
                  {d.summary.done}/{d.summary.total} · {d.summary.percent}%
                </span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${d.summary.percent}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={onlyMissing ? "default" : "outline"} onClick={() => setOnlyMissing((v) => !v)}>
                {onlyMissing ? "Mostrando só o que falta" : "Mostrar só o que falta"}
              </Button>
              {d.summary.missing > 0 && (
                <Button size="sm" variant="outline" onClick={() => openLabels(d.project.id, "a4", true)}>
                  <Printer className="mr-1 h-4 w-4" /> Reimprimir etiquetas do que falta
                </Button>
              )}
            </div>
            {d.summary.missing > 0 && (
              <p className="text-xs text-muted-foreground">Itens sem baixa não travam a produção: ficam marcados em vermelho para conferência antes da entrega.</p>
            )}
            <div className="divide-y divide-border rounded-lg border border-border">
              {items.map((i) => {
                const done = i.status === "DONE";
                return (
                  <div key={i.id} className={cn("flex items-center gap-3 px-3 py-2 text-sm", !done && "bg-destructive/5")}>
                    {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate font-medium", !done && "text-destructive")}>
                        {i.descricao}
                        {i.quantidade > 1 && <span className="ml-1 text-xs font-normal">×{i.quantidade}</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{[i.ambiente, i.modulo, i.medidas, i.material].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    {!done && i.sectorLabel && <Badge variant="secondary">{i.sectorLabel}</Badge>}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{i.code ?? "sem código"}</span>
                  </div>
                );
              })}
              {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{d.summary.total === 0 ? "Este projeto ainda não tem itens de produção." : "Nada faltando."}</p>}
            </div>
          </CardContent>
        </Card>
      )}
      {!d && !projectId && (
        <p className="text-sm text-muted-foreground">A conferência do projeto aparece aqui depois da primeira leitura. As etiquetas são impressas na aba Produção do projeto.</p>
      )}
    </div>
  );
}
