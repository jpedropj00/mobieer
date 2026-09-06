import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileText, Loader2, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
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
import { apiDelete, apiGet, apiPost } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/utils";

type Invoice = {
  id: string;
  kind: string;
  status: "DRAFT" | "QUEUED" | "PROCESSING" | "ISSUED" | "REJECTED" | "CANCELLED" | "ERROR";
  ref: string;
  number: string | null;
  amount: number;
  description: string | null;
  xmlUrl: string | null;
  pdfUrl: string | null;
  errorMessage: string | null;
  issuedAt: string | null;
  createdAt: string;
  project: { id: string; code: string; name: string } | null;
  client: { id: string; name: string } | null;
};
type FiscalConfig = { configured: boolean; provider: string; environment: string };
type ProjectLite = { id: string; code: string; name: string; client?: { id: string; name: string } | null };

const STATUS: Record<Invoice["status"], { label: string; variant: "muted" | "secondary" | "success" | "danger" | "warning" }> = {
  DRAFT: { label: "Rascunho", variant: "muted" },
  QUEUED: { label: "Na fila", variant: "secondary" },
  PROCESSING: { label: "Processando", variant: "secondary" },
  ISSUED: { label: "Autorizada", variant: "success" },
  REJECTED: { label: "Rejeitada", variant: "danger" },
  CANCELLED: { label: "Cancelada", variant: "muted" },
  ERROR: { label: "Erro", variant: "danger" },
};
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");

export function FiscalPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("finance.manage");

  const config = useQuery({ queryKey: ["fiscal", "config"], queryFn: () => apiGet<{ data: FiscalConfig }>("/fiscal/config") });
  const list = useQuery({ queryKey: ["fiscal", "list"], queryFn: () => apiGet<{ data: Invoice[] }>("/fiscal") });
  const projects = useQuery({
    queryKey: ["projects-lite"],
    queryFn: () => apiGet<{ data: ProjectLite[] }>("/business/projects"),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["fiscal", "list"] });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ projectId: "", amount: "", description: "" });

  const create = useMutation({
    mutationFn: () =>
      apiPost("/fiscal", {
        projectId: form.projectId || null,
        amount: Number(form.amount),
        description: form.description || null,
      }),
    onSuccess: () => { toast.success("Rascunho criado"); setOpen(false); setForm({ projectId: "", amount: "", description: "" }); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao criar")),
  });
  const issue = useMutation({
    mutationFn: (id: string) => apiPost(`/fiscal/${id}/issue`, {}),
    onSuccess: (r: unknown) => { toast.message((r as { message?: string })?.message ?? "Enviada"); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao emitir")),
  });
  const refresh = useMutation({
    mutationFn: (id: string) => apiPost(`/fiscal/${id}/refresh`, {}),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(errorMessage(e, "Falha ao atualizar")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/fiscal/${id}`),
    onSuccess: () => { toast.success("Removida"); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });

  if (list.isLoading) return <PageSkeleton />;
  const rows = list.data?.data ?? [];
  const cfg = config.data?.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Notas fiscais" description="Emissão de NF-e via provedor homologado.">
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Nova nota
          </Button>
        )}
      </PageHeader>

      {cfg && !cfg.configured && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            Provedor de NF-e ainda não configurado. É possível preparar rascunhos, mas a emissão só envia à SEFAZ depois
            de definir <code>NFE_PROVIDER</code>, <code>NFE_API_TOKEN</code> e <code>NFE_BASE_URL</code> no servidor.
          </p>
        </div>
      )}
      {cfg?.configured && (
        <p className="text-xs text-muted-foreground">
          Provedor: <strong>{cfg.provider}</strong> · ambiente: <strong>{cfg.environment}</strong>
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState title="Nenhuma nota" description="Crie um rascunho para começar." />
      ) : (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-base">Notas ({rows.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {rows.map((inv) => (
              <div key={inv.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {inv.number ? `NF ${inv.number}` : inv.ref}
                      {inv.project ? ` · ${inv.project.code}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {brl(inv.amount)}
                      {inv.client ? ` · ${inv.client.name}` : ""} · {fmtDate(inv.createdAt)}
                    </p>
                    {inv.description && <p className="mt-1 text-xs text-muted-foreground">{inv.description}</p>}
                    {inv.errorMessage && <p className="mt-1 text-xs text-destructive">{inv.errorMessage}</p>}
                  </div>
                  <Badge variant={STATUS[inv.status].variant}>{STATUS[inv.status].label}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {inv.pdfUrl && (
                    <a href={inv.pdfUrl} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline"><FileText className="mr-1 h-4 w-4" /> DANFE</Button>
                    </a>
                  )}
                  {canManage && (inv.status === "DRAFT" || inv.status === "ERROR") && (
                    <Button size="sm" disabled={issue.isPending} onClick={() => issue.mutate(inv.id)}>
                      {issue.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />} Emitir
                    </Button>
                  )}
                  {(inv.status === "PROCESSING" || inv.status === "QUEUED") && (
                    <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate(inv.id)}>
                      <RefreshCw className="mr-1 h-4 w-4" /> Atualizar
                    </Button>
                  )}
                  {canManage && ["DRAFT", "ERROR", "REJECTED", "CANCELLED"].includes(inv.status) && (
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(inv.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova nota fiscal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Projeto (opcional)</Label>
              <Select value={form.projectId || "NONE"} onValueChange={(v) => setForm({ ...form, projectId: v === "NONE" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Sem projeto</SelectItem>
                  {(projects.data?.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor total (R$)</Label>
              <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Descrição / informações adicionais</Label>
              <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={create.isPending || !(Number(form.amount) > 0)} onClick={() => create.mutate()}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar rascunho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
