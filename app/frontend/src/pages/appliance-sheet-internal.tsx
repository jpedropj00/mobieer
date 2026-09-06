import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageSkeleton } from "@/components/ui/states";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/utils";

type Item = {
  id: string;
  category: "COZINHA" | "GOURMET" | "LAVANDERIA" | "OUTROS";
  name: string;
  owned: boolean;
  willBuy: boolean;
  brandModel: string | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  referenceUrl: string | null;
  notes: string | null;
  custom: boolean;
  position: number;
};
type Sheet = {
  id: string;
  status: "DRAFT" | "SUBMITTED" | "REVIEWED";
  projetista: string | null;
  ambientes: string | null;
  notes: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: { id: string; name: string } | null;
  items: Item[];
};

const CATEGORY_LABEL: Record<Item["category"], string> = {
  COZINHA: "Cozinha",
  GOURMET: "Cozinha e área gourmet",
  LAVANDERIA: "Lavanderia",
  OUTROS: "Outros ambientes",
};
const CATEGORY_ORDER: Item["category"][] = ["COZINHA", "GOURMET", "LAVANDERIA", "OUTROS"];
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const dim = (v: number | null) => (v == null ? "—" : `${v}`);

export function ApplianceSheetInternal({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["appliance-sheet", projectId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => apiGet<{ data: Sheet }>(`/appliances/projects/${projectId}`),
  });

  const [addOpen, setAddOpen] = useState<null | Item["category"]>(null);
  const [addName, setAddName] = useState("");

  const patchSheet = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch(`/appliances/projects/${projectId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  const patchItem = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiPatch(`/appliances/items/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  const addItem = useMutation({
    mutationFn: () => apiPost(`/appliances/projects/${projectId}/items`, { category: addOpen, name: addName.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setAddOpen(null); setAddName(""); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao adicionar")),
  });
  const delItem = useMutation({
    mutationFn: (id: string) => apiDelete(`/appliances/items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });

  if (isLoading) return <PageSkeleton />;
  const sheet = data?.data;
  if (!sheet) return <p className="py-8 text-center text-sm text-muted-foreground">Ficha indisponível.</p>;

  const locked = sheet.status === "REVIEWED";
  const filledCount = sheet.items.filter((i) => i.owned || i.willBuy || i.brandModel || i.widthCm || i.heightCm || i.depthCm).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>Ficha de eletrodomésticos</span>
            <Badge variant={sheet.status === "REVIEWED" ? "success" : sheet.status === "SUBMITTED" ? "secondary" : "warning"}>
              {sheet.status === "REVIEWED" ? "Conferida" : sheet.status === "SUBMITTED" ? "Enviada pelo cliente" : "Em preenchimento"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Projetista</Label>
              <Input
                defaultValue={sheet.projetista ?? ""} disabled={!canManage || locked}
                onBlur={(e) => { if ((e.target.value.trim() || null) !== (sheet.projetista ?? null)) patchSheet.mutate({ projetista: e.target.value }); }}
              />
            </div>
            <div className="space-y-2">
              <Label>Ambientes do projeto</Label>
              <Input
                defaultValue={sheet.ambientes ?? ""} disabled={!canManage || locked}
                onBlur={(e) => { if ((e.target.value.trim() || null) !== (sheet.ambientes ?? null)) patchSheet.mutate({ ambientes: e.target.value }); }}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {filledCount} de {sheet.items.length} itens preenchidos · enviada {fmtDate(sheet.submittedAt)}
            {sheet.reviewedBy ? ` · conferida por ${sheet.reviewedBy.name} em ${fmtDate(sheet.reviewedAt)}` : ""}
          </p>
        </CardContent>
      </Card>

      {CATEGORY_ORDER.map((cat) => {
        const rows = sheet.items.filter((i) => i.category === cat).sort((a, b) => a.position - b.position);
        return (
          <Card key={cat}>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <CardTitle className="text-sm">{CATEGORY_LABEL[cat]}</CardTitle>
              {canManage && !locked && (
                <Button size="sm" variant="ghost" onClick={() => { setAddOpen(cat); setAddName(""); }}>
                  <Plus className="mr-1 h-4 w-4" /> Item
                </Button>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Eletrodoméstico</th>
                    <th className="px-2 py-2 font-medium">Possui</th>
                    <th className="px-2 py-2 font-medium">Vai comprar</th>
                    <th className="px-2 py-2 font-medium">Marca / modelo</th>
                    <th className="px-2 py-2 text-right font-medium">L</th>
                    <th className="px-2 py-2 text-right font-medium">A</th>
                    <th className="px-2 py-2 text-right font-medium">P</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => (
                    <tr key={it.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-4 py-2">
                        <p className="font-medium">{it.name}</p>
                        {it.referenceUrl && (
                          <a href={it.referenceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline break-all">
                            {it.referenceUrl}
                          </a>
                        )}
                        {it.notes && <p className="text-xs text-muted-foreground">{it.notes}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <input type="checkbox" checked={it.owned} disabled={!canManage || locked}
                          onChange={(e) => patchItem.mutate({ id: it.id, body: { owned: e.target.checked } })} />
                      </td>
                      <td className="px-2 py-2">
                        <input type="checkbox" checked={it.willBuy} disabled={!canManage || locked}
                          onChange={(e) => patchItem.mutate({ id: it.id, body: { willBuy: e.target.checked } })} />
                      </td>
                      <td className="px-2 py-2">
                        {canManage && !locked ? (
                          <InlineText value={it.brandModel ?? ""} onSave={(v) => patchItem.mutate({ id: it.id, body: { brandModel: v } })} />
                        ) : (
                          it.brandModel ?? "—"
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {canManage && !locked ? (
                          <InlineNum value={it.widthCm} onSave={(v) => patchItem.mutate({ id: it.id, body: { widthCm: v } })} />
                        ) : dim(it.widthCm)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {canManage && !locked ? (
                          <InlineNum value={it.heightCm} onSave={(v) => patchItem.mutate({ id: it.id, body: { heightCm: v } })} />
                        ) : dim(it.heightCm)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {canManage && !locked ? (
                          <InlineNum value={it.depthCm} onSave={(v) => patchItem.mutate({ id: it.id, body: { depthCm: v } })} />
                        ) : dim(it.depthCm)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {it.custom && canManage && !locked && (
                          <button className="text-muted-foreground hover:text-destructive" onClick={() => delItem.mutate(it.id)} aria-label="Remover">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-3 text-center text-xs text-muted-foreground">—</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Observações / instalações especiais</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            rows={3} defaultValue={sheet.notes ?? ""} disabled={!canManage || locked}
            onBlur={(e) => { if ((e.target.value.trim() || null) !== (sheet.notes ?? null)) patchSheet.mutate({ notes: e.target.value }); }}
          />
        </CardContent>
      </Card>

      {canManage && !locked && (
        <div className="flex items-center justify-end">
          <Button size="sm" variant="outline" disabled={patchSheet.isPending} onClick={() => patchSheet.mutate({ status: "REVIEWED" })}>
            <CheckCircle2 className="mr-2 h-4 w-4" /> Marcar como conferida
          </Button>
        </div>
      )}

      <Dialog open={addOpen !== null} onOpenChange={(v) => !v && setAddOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar item{addOpen ? ` — ${CATEGORY_LABEL[addOpen]}` : ""}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Nome do eletrodoméstico</Label>
            <Input value={addName} onChange={(e) => setAddName(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(null)}>Cancelar</Button>
            <Button disabled={addItem.isPending || addName.trim().length < 2} onClick={() => addItem.mutate()}>
              {addItem.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InlineText({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setV(value); }, [value]);
  return (
    <Input
      className="h-8 min-w-[8rem]" value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v.trim() !== (value ?? "")) onSave(v); }}
    />
  );
}

function InlineNum({ value, onSave }: { value: number | null; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value?.toString() ?? "");
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setV(value?.toString() ?? ""); }, [value]);
  return (
    <Input
      type="number" inputMode="decimal" className="h-8 w-20 text-right" value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = v.trim() === "" ? null : Number(v);
        if (n !== value) onSave(n);
      }}
    />
  );
}
