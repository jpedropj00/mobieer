import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Factory, Loader2, Play, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { cn, errorMessage } from "@/lib/utils";

export const SECTORS = ["CORTE", "FITA_BORDA", "FURACAO", "PRE_MONTAGEM", "EMBALAGEM", "EXPEDICAO"] as const;
export type Sector = (typeof SECTORS)[number];
export const SECTOR_LABEL: Record<Sector, string> = {
  CORTE: "Corte",
  FITA_BORDA: "Fita de borda",
  FURACAO: "Furação",
  PRE_MONTAGEM: "Pré-montagem",
  EMBALAGEM: "Embalagem",
  EXPEDICAO: "Expedição",
};

export type ProductionItem = {
  id: string;
  ambiente: string | null;
  descricao: string;
  referencia: string | null;
  quantidade: number;
  material: string | null;
  status: "PENDING" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  sector: Sector | null;
  sectorLabel: string | null;
  nextSector: Sector | null;
  notes: string | null;
  events: { id: string; sectorLabel: string | null; action: string; note: string | null; createdAt: string; author: string | null }[];
  project?: { id: string; code: string; name: string };
};
type Summary = { total: number; pending: number; inProgress: number; done: number; cancelled: number; bySector: Record<string, number>; progress: number };

const fmtDateTime = (v: string) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const STATUS_BADGE: Record<ProductionItem["status"], { label: string; variant: "muted" | "secondary" | "success" | "danger" }> = {
  PENDING: { label: "Aguardando", variant: "muted" },
  IN_PROGRESS: { label: "Em produção", variant: "secondary" },
  DONE: { label: "Concluído", variant: "success" },
  CANCELLED: { label: "Cancelado", variant: "danger" },
};

/* ============================ actions ============================ */

function useItemActions(invalidate: () => void) {
  const qc = useQueryClient();
  const done = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["factory-board"] });
  };
  const advance = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiPost(`/production/items/${id}/advance`, body),
    onSuccess: () => done(),
    onError: (e) => toast.error(errorMessage(e, "Falha ao atualizar o item")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/production/items/${id}`),
    onSuccess: () => { toast.success("Item removido"); done(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });
  return { advance, remove };
}

function AdvanceButtons({ item, canManage, invalidate }: { item: ProductionItem; canManage: boolean; invalidate: () => void }) {
  const { advance, remove } = useItemActions(invalidate);
  if (!canManage) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {item.status === "PENDING" && (
        <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate({ id: item.id, body: { action: "start" } })}>
          <Play className="mr-1 h-4 w-4" /> Iniciar (Corte)
        </Button>
      )}
      {item.status === "IN_PROGRESS" && (
        <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate({ id: item.id, body: { action: "complete" } })}>
          {advance.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-1 h-4 w-4" />}
          {item.nextSector ? `Concluir → ${SECTOR_LABEL[item.nextSector]}` : "Concluir item"}
        </Button>
      )}
      {(item.status === "DONE" || item.status === "CANCELLED") && (
        <Button size="sm" variant="outline" disabled={advance.isPending} onClick={() => advance.mutate({ id: item.id, body: { action: "reopen" } })}>
          <RotateCcw className="mr-1 h-4 w-4" /> Reabrir
        </Button>
      )}
      {item.status !== "CANCELLED" && item.status !== "DONE" && (
        <Button size="sm" variant="ghost" className="text-destructive" disabled={advance.isPending} onClick={() => advance.mutate({ id: item.id, body: { action: "cancel" } })}>
          <X className="h-4 w-4" />
        </Button>
      )}
      {(item.status === "PENDING" || item.status === "CANCELLED") && (
        <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(item.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/* ============================ per-project panel ============================ */

export function ProductionItemsPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["production-items", projectId];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: { items: ProductionItem[]; summary: Summary } }>(`/production/projects/${projectId}/items`) });
  const imports = useQuery({
    queryKey: ["promob", projectId],
    queryFn: () => apiGet<{ data: { id: string; fileName: string; status: string; itemCount: number }[] }>(`/promob/projects/${projectId}/imports`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ descricao: "", ambiente: "", referencia: "", quantidade: "1", material: "" });
  const add = useMutation({
    mutationFn: () => apiPost(`/production/projects/${projectId}/items`, { ...form, quantidade: Number(form.quantidade) || 1 }),
    onSuccess: () => { toast.success("Item adicionado"); setAddOpen(false); setForm({ descricao: "", ambiente: "", referencia: "", quantidade: "1", material: "" }); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao adicionar")),
  });
  const fromImport = useMutation({
    mutationFn: (importId: string) => apiPost(`/production/projects/${projectId}/items/from-import/${importId}`, {}),
    onSuccess: (r: unknown) => { toast.success((r as { message?: string })?.message ?? "Itens gerados"); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao gerar itens")),
  });

  if (q.isLoading) return <PageSkeleton />;
  const items = q.data?.data.items ?? [];
  const summary = q.data?.data.summary;
  const parsedImports = (imports.data?.data ?? []).filter((i) => i.status === "PARSED" && i.itemCount > 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>Itens de produção</span>
            {summary && summary.total > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {summary.done}/{summary.total - summary.cancelled} concluídos · {summary.progress}%
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {summary && summary.total > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${summary.progress}%` }} />
            </div>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Adicionar item
              </Button>
              {parsedImports.map((imp) => (
                <Button key={imp.id} size="sm" variant="outline" disabled={fromImport.isPending} onClick={() => fromImport.mutate(imp.id)}>
                  {fromImport.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Factory className="mr-1 h-4 w-4" />}
                  Gerar de “{imp.fileName}”
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <EmptyState title="Nenhum item de produção" description="Adicione manualmente ou gere a partir de uma importação do Promob (aba Promob)." />
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {it.descricao}
                    {it.quantidade > 1 && <span className="ml-1 text-xs text-muted-foreground">×{it.quantidade}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[it.ambiente, it.referencia, it.material].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {it.status === "IN_PROGRESS" && it.sectorLabel && <Badge variant="secondary">{it.sectorLabel}</Badge>}
                  <Badge variant={STATUS_BADGE[it.status].variant}>{STATUS_BADGE[it.status].label}</Badge>
                </div>
              </div>
              <div className="mt-3">
                <AdvanceButtons item={it} canManage={canManage} invalidate={invalidate} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar item de produção</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2"><Label>Descrição</Label>
              <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Ex.: Armário superior 800mm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Ambiente</Label>
                <Input value={form.ambiente} onChange={(e) => setForm({ ...form, ambiente: e.target.value })} />
              </div>
              <div className="space-y-2"><Label>Referência</Label>
                <Input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} />
              </div>
              <div className="space-y-2"><Label>Quantidade</Label>
                <Input type="number" min="1" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} />
              </div>
              <div className="space-y-2"><Label>Material</Label>
                <Input value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} placeholder="Ex.: MDF Branco 18mm" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button disabled={add.isPending || form.descricao.trim().length < 2} onClick={() => add.mutate()}>
              {add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================ factory board page ============================ */

type BoardColumn = { sector: Sector; label: string; items: ProductionItem[] };

export function FactoryBoardPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("organization.manage");
  const q = useQuery({ queryKey: ["factory-board"], queryFn: () => apiGet<{ data: { columns: BoardColumn[] } }>("/production/board") });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["factory-board"] });

  const total = useMemo(() => (q.data?.data.columns ?? []).reduce((n, c) => n + c.items.length, 0), [q.data]);
  if (q.isLoading) return <PageSkeleton />;
  const columns = q.data?.data.columns ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Fábrica" description="Itens em produção por setor. Cada operador conclui o seu setor e o item avança." />
      {total === 0 ? (
        <EmptyState title="Nada em produção" description="Os itens aparecem aqui quando entram na fábrica (aba Produção do projeto)." />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => (
            <div key={col.sector} className="w-72 shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{col.label}</h3>
                <Badge variant={col.items.length ? "secondary" : "muted"}>{col.items.length}</Badge>
              </div>
              <div className="space-y-2">
                {col.items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">vazio</p>
                ) : (
                  col.items.map((it) => (
                    <div key={it.id} className="rounded-lg border border-border bg-card p-3">
                      <p className="text-sm font-medium leading-tight">{it.descricao}{it.quantidade > 1 ? ` ×${it.quantidade}` : ""}</p>
                      {it.project && (
                        <Link to={`/clientes-projetos/${it.project.id}`} className="text-xs text-muted-foreground hover:underline">
                          {it.project.code}
                        </Link>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground">{[it.ambiente, it.referencia].filter(Boolean).join(" · ")}</p>
                      <div className="mt-2">
                        <AdvanceButtons item={it} canManage={canManage} invalidate={invalidate} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
