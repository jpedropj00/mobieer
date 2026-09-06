import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/utils";
import { portalDelete, portalGet, portalPatch, portalPost } from "@/services/portal-api";

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
  ambientes: string | null;
  notes: string | null;
  submittedAt: string | null;
  project: { id: string; code: string; name: string } | null;
};

const CATEGORY_LABEL: Record<Item["category"], string> = {
  COZINHA: "Cozinha",
  GOURMET: "Cozinha e área gourmet",
  LAVANDERIA: "Lavanderia",
  OUTROS: "Outros ambientes",
};
const CATEGORY_ORDER: Item["category"][] = ["COZINHA", "GOURMET", "LAVANDERIA", "OUTROS"];

export function PortalApplianceSheet({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const key = ["portal", "appliance-sheet", projectId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => portalGet<{ data: Sheet & { items: Item[] } }>(`/projects/${projectId}/appliance-sheet`),
  });

  const [addOpen, setAddOpen] = useState<null | Item["category"]>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const patchItem = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => portalPatch(`/appliance-items/${id}`, body),
    onMutate: ({ id }) => setSavingId(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
    onSettled: () => setSavingId(null),
  });
  const patchSheet = useMutation({
    mutationFn: (body: Record<string, unknown>) => portalPatch(`/projects/${projectId}/appliance-sheet`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  const addItem = useMutation({
    mutationFn: ({ category, name }: { category: string; name: string }) =>
      portalPost(`/projects/${projectId}/appliance-sheet/items`, { category, name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setAddOpen(null); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao adicionar")),
  });
  const delItem = useMutation({
    mutationFn: (id: string) => portalDelete(`/appliance-items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });
  const submit = useMutation({
    mutationFn: () => portalPost(`/projects/${projectId}/appliance-sheet/submit`),
    onSuccess: () => { toast.success("Ficha enviada. Obrigado!"); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao enviar")),
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  const sheet = data?.data;
  if (!sheet) return <p className="py-16 text-center text-sm text-muted-foreground">Ficha não encontrada.</p>;

  const locked = sheet.status === "REVIEWED";
  const items = sheet.items;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>Ficha de eletrodomésticos</span>
            <Badge variant={sheet.status === "REVIEWED" ? "success" : sheet.status === "SUBMITTED" ? "secondary" : "warning"}>
              {sheet.status === "REVIEWED" ? "Conferida" : sheet.status === "SUBMITTED" ? "Enviada" : "Em preenchimento"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Preencha antes da finalização do projeto. Informe as <strong>medidas exatas</strong> do produto.
            Se ainda vai comprar, marque “Vai comprar” e cole o link ou a referência do modelo escolhido.
          </p>
          <div className="space-y-2">
            <Label>Ambientes do projeto</Label>
            <Input
              defaultValue={sheet.ambientes ?? ""}
              disabled={locked}
              placeholder="Ex.: Cozinha, Área gourmet, Lavanderia"
              onBlur={(e) => { if ((e.target.value.trim() || null) !== (sheet.ambientes ?? null)) patchSheet.mutate({ ambientes: e.target.value }); }}
            />
          </div>
          {locked && (
            <p className="rounded-md bg-success/10 px-3 py-2 text-xs text-success">
              A ficha já foi conferida pela equipe. Para alterações, fale com seu consultor.
            </p>
          )}
        </CardContent>
      </Card>

      {CATEGORY_ORDER.map((cat) => {
        const rows = items.filter((i) => i.category === cat).sort((a, b) => a.position - b.position);
        return (
          <Card key={cat}>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <CardTitle className="text-sm">{CATEGORY_LABEL[cat]}</CardTitle>
              {!locked && (
                <Button size="sm" variant="ghost" onClick={() => setAddOpen(cat)}>
                  <Plus className="mr-1 h-4 w-4" /> Item
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {rows.map((it) => (
                <ItemRow
                  key={it.id}
                  it={it}
                  locked={locked}
                  saving={savingId === it.id}
                  onPatch={(body) => patchItem.mutate({ id: it.id, body })}
                  onDelete={() => delItem.mutate(it.id)}
                />
              ))}
              {rows.length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">—</p>}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Observações / instalações especiais</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            rows={3}
            defaultValue={sheet.notes ?? ""}
            disabled={locked}
            placeholder="Pontos de água/gás/elétrica, nichos, exaustão, algo que a equipe precisa saber…"
            onBlur={(e) => { if ((e.target.value.trim() || null) !== (sheet.notes ?? null)) patchSheet.mutate({ notes: e.target.value }); }}
          />
        </CardContent>
      </Card>

      {!locked && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {sheet.status === "SUBMITTED"
              ? "Ficha enviada. Você ainda pode ajustar e reenviar até a equipe conferir."
              : "Quando terminar, envie a ficha para a equipe."}
          </p>
          <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {sheet.status === "SUBMITTED" ? "Reenviar" : "Enviar ficha"}
          </Button>
        </div>
      )}

      <AddItemDialog
        open={addOpen !== null}
        category={addOpen}
        pending={addItem.isPending}
        onClose={() => setAddOpen(null)}
        onAdd={(name) => addOpen && addItem.mutate({ category: addOpen, name })}
      />
    </div>
  );
}

function ItemRow({
  it, locked, saving, onPatch, onDelete,
}: {
  it: Item;
  locked: boolean;
  saving: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  // Campos de texto/número: rascunho local, salva no blur.
  const [brand, setBrand] = useState(it.brandModel ?? "");
  const [w, setW] = useState(it.widthCm?.toString() ?? "");
  const [h, setH] = useState(it.heightCm?.toString() ?? "");
  const [d, setD] = useState(it.depthCm?.toString() ?? "");
  const [ref, setRef] = useState(it.referenceUrl ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setBrand(it.brandModel ?? ""); setW(it.widthCm?.toString() ?? ""); setH(it.heightCm?.toString() ?? "");
    setD(it.depthCm?.toString() ?? ""); setRef(it.referenceUrl ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it.id]);

  const saveNum = (val: string, current: number | null, field: string) => {
    const n = val.trim() === "" ? null : Number(val);
    if (n === current) return;
    onPatch({ [field]: n });
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">
          {it.name}
          {saving && <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-muted-foreground" />}
        </p>
        {it.custom && !locked && (
          <button className="text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label="Remover">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={it.owned} disabled={locked} onChange={(e) => onPatch({ owned: e.target.checked })} />
          Já possui
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={it.willBuy} disabled={locked} onChange={(e) => onPatch({ willBuy: e.target.checked })} />
          Vai comprar
        </label>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Marca / modelo</Label>
          <Input
            value={brand} disabled={locked}
            onChange={(e) => setBrand(e.target.value)}
            onBlur={() => { if ((brand.trim() || null) !== (it.brandModel ?? null)) onPatch({ brandModel: brand }); }}
          />
        </div>
        {it.willBuy && (
          <div className="space-y-1">
            <Label className="text-xs">Link / referência do modelo</Label>
            <Input
              value={ref} disabled={locked} placeholder="https://…"
              onChange={(e) => setRef(e.target.value)}
              onBlur={() => { if ((ref.trim() || null) !== (it.referenceUrl ?? null)) onPatch({ referenceUrl: ref }); }}
            />
          </div>
        )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Largura (cm)</Label>
          <Input type="number" inputMode="decimal" value={w} disabled={locked}
            onChange={(e) => setW(e.target.value)} onBlur={() => saveNum(w, it.widthCm, "widthCm")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Altura (cm)</Label>
          <Input type="number" inputMode="decimal" value={h} disabled={locked}
            onChange={(e) => setH(e.target.value)} onBlur={() => saveNum(h, it.heightCm, "heightCm")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Prof. (cm)</Label>
          <Input type="number" inputMode="decimal" value={d} disabled={locked}
            onChange={(e) => setD(e.target.value)} onBlur={() => saveNum(d, it.depthCm, "depthCm")} />
        </div>
      </div>
    </div>
  );
}

function AddItemDialog({
  open, category, pending, onClose, onAdd,
}: {
  open: boolean;
  category: Item["category"] | null;
  pending: boolean;
  onClose: () => void;
  onAdd: (name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar item{category ? ` — ${CATEGORY_LABEL[category]}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Nome do eletrodoméstico</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Ar-condicionado, Purificador…" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={pending || name.trim().length < 2} onClick={() => onAdd(name.trim())}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
