import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiDelete, apiGet, apiPost, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Automation = {
  event: string;
  label: string;
  description: string;
  vars: string[];
  enabled: boolean;
  body: string;
  defaultBody: string;
  metaTemplateName: string | null;
  delayDays: number;
  customized: boolean;
  preview: string;
};
type LogRow = { id: string; event: string; label: string; status: string; to: string | null; clientName: string | null; body: string; error: string | null; createdAt: string };

const STATUS_LABEL: Record<string, { label: string; variant: "success" | "muted" | "warning" | "danger" }> = {
  SENT: { label: "Enviada", variant: "success" },
  LOGGED: { label: "Só no log", variant: "muted" },
  SKIPPED: { label: "Não enviada", variant: "warning" },
  FAILED: { label: "Falhou", variant: "danger" },
};

/** Configuração das mensagens automáticas de WhatsApp. */
export function AutomationsSettings() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["automations"],
    queryFn: () => apiGet<{ data: { whatsappConfigured: boolean; automations: Automation[] } }>("/automations"),
  });
  const logs = useQuery({ queryKey: ["automations", "logs"], queryFn: () => apiGet<{ data: LogRow[] }>("/automations/logs", { limit: 30 }) });
  const [editing, setEditing] = useState<Automation | null>(null);
  const [draft, setDraft] = useState({ body: "", enabled: true, metaTemplateName: "", delayDays: 0 });
  const [testPhone, setTestPhone] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["automations"] });
  };

  const save = useMutation({
    mutationFn: () =>
      apiPut(`/automations/${editing!.event}`, {
        enabled: draft.enabled,
        body: draft.body,
        metaTemplateName: draft.metaTemplateName || null,
        delayDays: draft.delayDays,
      }),
    onSuccess: () => {
      toast.success("Mensagem salva");
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar")),
  });
  const reset = useMutation({
    mutationFn: (event: string) => apiDelete(`/automations/${event}`),
    onSuccess: () => {
      toast.success("Texto padrão restaurado");
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível restaurar")),
  });
  const toggle = useMutation({
    mutationFn: (a: Automation) =>
      apiPut(`/automations/${a.event}`, { enabled: !a.enabled, body: a.body, metaTemplateName: a.metaTemplateName, delayDays: a.delayDays }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e, "Não foi possível alterar")),
  });
  const test = useMutation({
    mutationFn: () => apiPost<{ message?: string }>(`/automations/${editing!.event}/test`, { phone: testPhone }),
    onSuccess: (r) => toast.success(r.message ?? "Teste enviado"),
    onError: (e) => toast.error(errorMessage(e, "Falha no teste")),
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const data = q.data?.data;
  if (!data) return <p className="text-sm text-destructive">{errorMessage(q.error, "Não foi possível carregar")}</p>;

  return (
    <div className="space-y-4">
      {!data.whatsappConfigured && (
        <p className="rounded-md bg-warning/10 p-3 text-sm">
          O WhatsApp ainda não está configurado (WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID). As mensagens continuam sendo montadas e ficam registradas no log,
          mas não saem para o cliente.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {data.automations.map((a) => (
          <Card key={a.event} className={a.enabled ? "" : "opacity-70"}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-start justify-between gap-2 text-base">
                <span>{a.label}</span>
                <div className="flex items-center gap-2">
                  {a.customized && <Badge variant="secondary">editada</Badge>}
                  <Switch checked={a.enabled} onCheckedChange={() => toggle.mutate(a)} aria-label={`Ligar ${a.label}`} />
                </div>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{a.description}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{a.preview}</p>
              <div className="flex items-center justify-between">
                {a.delayDays > 0 && <span className="text-xs text-muted-foreground">envia {a.delayDays} dia(s) depois</span>}
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    setEditing(a);
                    setDraft({ body: a.body, enabled: a.enabled, metaTemplateName: a.metaTemplateName ?? "", delayDays: a.delayDays });
                  }}
                >
                  Editar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" /> Últimas mensagens
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(logs.data?.data ?? []).length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
          ) : (
            (logs.data?.data ?? []).map((l) => {
              const st = STATUS_LABEL[l.status] ?? { label: l.status, variant: "muted" as const };
              return (
                <div key={l.id} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 text-sm last:border-0">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {l.label} {l.clientName && <span className="font-normal text-muted-foreground">· {l.clientName}</span>}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{l.body}</p>
                    {l.error && <p className="text-xs text-destructive">{l.error}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge variant={st.variant}>{st.label}</Badge>
                    <p className="mt-1 text-[11px] text-muted-foreground">{new Date(l.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.label}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Switch id="auto-on" checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
                <Label htmlFor="auto-on">{draft.enabled ? "Ligada" : "Desligada"}</Label>
              </div>
              <div className="space-y-2">
                <Label>Texto</Label>
                <Textarea rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                <div className="flex flex-wrap gap-1">
                  {editing.vars.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, body: `${d.body}{{${v}}}` }))}
                      className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent"
                    >
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>
              </div>
              {editing.event === "POST_SALE_FOLLOWUP" && (
                <div className="space-y-2">
                  <Label>Dias após a entrega</Label>
                  <Input type="number" min={0} max={90} value={draft.delayDays} onChange={(e) => setDraft({ ...draft, delayDays: Number(e.target.value) })} />
                </div>
              )}
              <div className="space-y-2">
                <Label>Template aprovado na Meta (opcional)</Label>
                <Input
                  value={draft.metaTemplateName}
                  onChange={(e) => setDraft({ ...draft, metaTemplateName: e.target.value })}
                  placeholder="ex.: visita_assistencia"
                />
                <p className="text-xs text-muted-foreground">
                  O WhatsApp só deixa iniciar conversa com template aprovado. Sem isso, a mensagem só chega se o cliente falou com a loja nas últimas 24h.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Testar em um número</Label>
                <div className="flex gap-2">
                  <Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="(85) 9...." />
                  <Button variant="outline" disabled={testPhone.trim().length < 8 || test.isPending} onClick={() => test.mutate()}>
                    {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {editing?.customized && (
              <Button variant="ghost" className="mr-auto" disabled={reset.isPending} onClick={() => reset.mutate(editing.event)}>
                <RotateCcw className="mr-2 h-4 w-4" /> Texto padrão
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button disabled={draft.body.trim().length < 5 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
