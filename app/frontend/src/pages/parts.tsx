import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, ClipboardList, Loader2, Package, Plus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { compressImage } from "@/lib/image";
import { useAuth } from "@/hooks/use-auth";

// ---------------------------------------------------------------------------

type Item = {
  id?: string;
  name: string;
  code: string | null;
  description: string | null;
  quantity: number;
  width: number | null;
  height: number | null;
  depth: number | null;
  thickness: number | null;
  unit: string;
  finish: string | null;
  color: string | null;
  material: string | null;
  notes: string | null;
};

type Photo = {
  id: string;
  kind: string;
  fileName: string;
  caption: string | null;
  hasOcr: boolean;
  ocrText: string | null;
  ocrSuggestion: Record<string, unknown> | null;
  ocrConfirmedAt: string | null;
  uploadedBy: { name: string } | null;
};

type PartRequest = {
  id: string;
  number: string;
  status: string;
  statusLabel: string;
  priority: string;
  title: string;
  roomType: string | null;
  roomLabel: string | null;
  neededAt: string | null;
  notes: string | null;
  refusalReason: string | null;
  contractor: { id: string; name: string } | null;
  project: { id: string; code: string; name: string } | null;
  activity: { id: string; number: string; service: string } | null;
  createdBy: { id: string; name: string } | null;
  itemCount: number;
  totalQuantity: number;
  isFinal: boolean;
  nextStatuses: { status: string; label: string }[];
  items: Item[];
  photos: Photo[];
  history: { id: string; user: { name: string } | null; fromLabel: string | null; toLabel: string; note: string | null; createdAt: string }[];
};

const STATUS_VARIANT: Record<string, "success" | "muted" | "warning" | "danger" | "secondary"> = {
  RASCUNHO: "muted",
  ENVIADA: "secondary",
  EM_ANALISE: "secondary",
  APROVADA: "success",
  RECUSADA: "danger",
  EM_PRODUCAO: "warning",
  PRONTA: "warning",
  EM_TRANSPORTE: "warning",
  ENTREGUE: "success",
  INSTALADA: "success",
  CONCLUIDA: "success",
  CANCELADA: "muted",
};

const PRIORITY_LABEL: Record<string, string> = { LOW: "Baixa", NORMAL: "Normal", HIGH: "Alta", URGENT: "Urgente" };
const dmy = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");
const mm = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("pt-BR")} mm`);

const itemVazio = (): Item => ({
  name: "", code: null, description: null, quantity: 1,
  width: null, height: null, depth: null, thickness: null,
  unit: "UNIT", finish: null, color: null, material: null, notes: null,
});

// ---------------------------------------------------------------------------

/** Solicitação de peças: o montador pede, a equipe analisa, produz e entrega. */
export function PartsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState({ status: "", q: "", open: "true" });
  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);

  const params = useMemo(() => Object.fromEntries(Object.entries(filtro).filter(([, v]) => v)), [filtro]);

  const lista = useQuery({ queryKey: ["parts", params], queryFn: () => apiGet<{ data: PartRequest[] }>("/parts", params) });
  const resumo = useQuery({
    queryKey: ["parts", "summary"],
    queryFn: () => apiGet<{ data: { byStatus: { status: string; label: string; count: number }[]; total: number; open: number } }>("/parts/summary"),
  });
  const opcoes = useQuery({
    queryKey: ["parts", "options"],
    queryFn: () =>
      apiGet<{ data: { statuses: { value: string; label: string }[]; priorities: string[]; roomTypes: string[]; units: string[]; maxItems: number } }>(
        "/parts/options"
      ),
    staleTime: 10 * 60_000,
  });

  const recarregar = () => qc.invalidateQueries({ queryKey: ["parts"] });
  const itens = lista.data?.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Solicitação de peças" description="Peças pedidas da obra pelos montadores externos, do pedido à instalação.">
        {can("parts.create") && (
          <Button onClick={() => setNova(true)}>
            <Plus className="h-4 w-4" /> Nova solicitação
          </Button>
        )}
      </PageHeader>

      {/* Quadro por status */}
      <div className="flex flex-wrap gap-2">
        {(resumo.data?.data.byStatus ?? [])
          .filter((s) => s.count > 0)
          .map((s) => (
            <button
              key={s.status}
              onClick={() => setFiltro((f) => ({ ...f, status: f.status === s.status ? "" : s.status, open: "" }))}
              className={`rounded-lg border px-3 py-2 text-left transition ${filtro.status === s.status ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"}`}
            >
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-semibold tabular-nums">{s.count}</p>
            </button>
          ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="min-w-[200px] flex-1">
            <Label htmlFor="p-q">Buscar</Label>
            <Input id="p-q" placeholder="Número, peça, ambiente…" value={filtro.q} onChange={(e) => setFiltro({ ...filtro, q: e.target.value })} />
          </div>
          <div className="min-w-[170px]">
            <Label>Status</Label>
            <Select value={filtro.status || "__todos"} onValueChange={(v) => setFiltro({ ...filtro, status: v === "__todos" ? "" : v, open: "" })}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos">Todos</SelectItem>
                {(opcoes.data?.data.statuses ?? []).map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant={filtro.open === "true" ? "default" : "outline"} onClick={() => setFiltro({ status: "", q: filtro.q, open: filtro.open === "true" ? "" : "true" })}>
            Só em andamento
          </Button>
        </CardContent>
      </Card>

      {lista.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : itens.length === 0 ? (
        <EmptyState title="Nenhuma solicitação" description="Quando um montador pedir peças da obra, elas aparecem aqui." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {itens.map((r) => (
            <Card key={r.id} className="cursor-pointer transition hover:border-primary/40" onClick={() => setAberta(r.id)}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-start justify-between gap-2 text-base">
                  <span className="min-w-0">
                    <span className="block truncate">{r.title}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{r.number}</span>
                  </span>
                  <Badge variant={STATUS_VARIANT[r.status] ?? "muted"}>{r.statusLabel}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                {r.roomLabel && <p className="truncate">{r.roomLabel}</p>}
                {r.contractor && <p className="truncate">Montador: {r.contractor.name}</p>}
                {r.project && <p className="truncate">{r.project.code} · {r.project.name}</p>}
                <p className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="inline-flex items-center gap-1"><Package className="h-3.5 w-3.5" /> {r.itemCount} peça(s) · {r.totalQuantity} un.</span>
                  {r.priority !== "NORMAL" && <Badge variant={r.priority === "URGENT" ? "danger" : "warning"}>{PRIORITY_LABEL[r.priority]}</Badge>}
                </p>
                {r.neededAt && <p className="text-xs">Precisa até {dmy(r.neededAt)}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {nova && <NovaSolicitacao onClose={() => setNova(false)} onSaved={recarregar} opcoes={opcoes.data?.data} />}
      {aberta && <Detalhe id={aberta} onClose={() => setAberta(null)} onChanged={recarregar} opcoes={opcoes.data?.data} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nova solicitação
// ---------------------------------------------------------------------------

function NovaSolicitacao({
  onClose,
  onSaved,
  opcoes,
}: {
  onClose: () => void;
  onSaved: () => void;
  opcoes?: { priorities: string[]; roomTypes: string[]; units: string[]; maxItems: number };
}) {
  const [v, setV] = useState({ title: "", roomType: "", roomLabel: "", priority: "NORMAL", neededAt: "", notes: "", projectId: "" });
  const [itens, setItens] = useState<Item[]>([itemVazio()]);

  const projetos = useQuery({
    queryKey: ["projects", "picklist"],
    queryFn: () => apiGet<{ data: { id: string; code: string; name: string }[] }>("/business/projects"),
    staleTime: 5 * 60_000,
  });

  const salvar = useMutation({
    mutationFn: () =>
      apiPost<{ data: { id: string; number: string } }>("/parts", {
        ...v,
        roomType: v.roomType || null,
        roomLabel: v.roomLabel || null,
        neededAt: v.neededAt || null,
        notes: v.notes || null,
        projectId: v.projectId || null,
        items: itens.filter((i) => i.name.trim()),
      }),
    onSuccess: (r) => {
      toast.success(`Solicitação ${r.data.number} criada como rascunho`);
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível criar")),
  });

  const alterar = (i: number, campo: keyof Item, valor: unknown) =>
    setItens((lista) => lista.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nova solicitação de peças</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="O que você precisa *" className="sm:col-span-2">
              <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Porta da cozinha veio com medida errada" />
            </Campo>
            <Campo label="Ambiente">
              <Input value={v.roomLabel} onChange={(e) => setV({ ...v, roomLabel: e.target.value })} placeholder="Cozinha, banheiro da suíte…" />
            </Campo>
            <Campo label="Tipo de cômodo">
              <Select value={v.roomType || "__nenhum"} onValueChange={(x) => setV({ ...v, roomType: x === "__nenhum" ? "" : x })}>
                <SelectTrigger><SelectValue placeholder="Não informado" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhum">Não informado</SelectItem>
                  {(opcoes?.roomTypes ?? []).map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ").toLowerCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Obra">
              <Select value={v.projectId || "__nenhum"} onValueChange={(x) => setV({ ...v, projectId: x === "__nenhum" ? "" : x })}>
                <SelectTrigger><SelectValue placeholder="Sem obra" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhum">Sem obra</SelectItem>
                  {(projetos.data?.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} · {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Prioridade">
              <Select value={v.priority} onValueChange={(x) => setV({ ...v, priority: x })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(opcoes?.priorities ?? ["LOW", "NORMAL", "HIGH", "URGENT"]).map((p) => (
                    <SelectItem key={p} value={p}>{PRIORITY_LABEL[p] ?? p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Precisa até">
              <Input type="date" value={v.neededAt} onChange={(e) => setV({ ...v, neededAt: e.target.value })} />
            </Campo>
            <Campo label="Observações" className="sm:col-span-2">
              <Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="Detalhe o que aconteceu na obra" />
            </Campo>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium">Peças ({itens.length})</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setItens([...itens, itemVazio()])}
                disabled={itens.length >= (opcoes?.maxItems ?? 50)}
              >
                <Plus className="h-4 w-4" /> Adicionar peça
              </Button>
            </div>
            <div className="space-y-3">
              {itens.map((it, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Peça {i + 1}</span>
                    {itens.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => setItens(itens.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Campo label="Nome *" className="sm:col-span-2">
                      <Input value={it.name} onChange={(e) => alterar(i, "name", e.target.value)} placeholder="Porta, prateleira, lateral…" />
                    </Campo>
                    <Campo label="Código">
                      <Input value={it.code ?? ""} onChange={(e) => alterar(i, "code", e.target.value || null)} />
                    </Campo>
                    <Campo label="Quantidade *">
                      <Input type="number" min={1} value={it.quantity} onChange={(e) => alterar(i, "quantity", Number(e.target.value))} />
                    </Campo>
                    {(["width", "height", "depth", "thickness"] as const).map((campo) => (
                      <Campo key={campo} label={`${{ width: "Largura", height: "Altura", depth: "Profundidade", thickness: "Espessura" }[campo]} (mm)`}>
                        <Input
                          type="number"
                          min={0}
                          value={it[campo] ?? ""}
                          onChange={(e) => alterar(i, campo, e.target.value ? Number(e.target.value) : null)}
                        />
                      </Campo>
                    ))}
                    <Campo label="Material">
                      <Input value={it.material ?? ""} onChange={(e) => alterar(i, "material", e.target.value || null)} placeholder="MDF 18mm" />
                    </Campo>
                    <Campo label="Cor">
                      <Input value={it.color ?? ""} onChange={(e) => alterar(i, "color", e.target.value || null)} />
                    </Campo>
                    <Campo label="Acabamento">
                      <Input value={it.finish ?? ""} onChange={(e) => alterar(i, "finish", e.target.value || null)} placeholder="Fita de borda" />
                    </Campo>
                    <Campo label="Observações" className="sm:col-span-4">
                      <Input value={it.notes ?? ""} onChange={(e) => alterar(i, "notes", e.target.value || null)} />
                    </Campo>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !v.title.trim()}>
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar rascunho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------

function Detalhe({
  id,
  onClose,
  onChanged,
  opcoes,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  opcoes?: { units: string[] };
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [recusa, setRecusa] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const q = useQuery({ queryKey: ["part", id], queryFn: () => apiGet<{ data: PartRequest }>(`/parts/${id}`) });
  const r = q.data?.data;

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["part", id] });
    onChanged();
  };

  const mover = useMutation({
    mutationFn: (p: { status: string; refusalReason?: string }) => apiPost<{ message?: string }>(`/parts/${id}/status`, p),
    onSuccess: (res) => {
      toast.success(res.message ?? "Solicitação atualizada");
      setRecusa(null);
      setMotivo("");
      atualizar();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível mover a solicitação")),
  });

  const enviarFoto = useMutation({
    mutationFn: async (file: File) => {
      // a Vercel corta requisição acima de ~4,5MB: a foto da obra vem comprimida
      const comprimida = await compressImage(file);
      const fd = new FormData();
      fd.append("photo", comprimida);
      fd.append("kind", "PECA");
      return apiPostForm(`/parts/${id}/photos`, fd);
    },
    onSuccess: () => { toast.success("Foto anexada"); atualizar(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível anexar a foto")),
  });

  const apagarFoto = useMutation({
    mutationFn: (photoId: string) => apiDelete(`/parts/photos/${photoId}`),
    onSuccess: () => { toast.success("Foto removida"); atualizar(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível remover")),
  });

  const confirmarLeitura = useMutation({
    mutationFn: (photoId: string) => apiPost(`/parts/photos/${photoId}/ocr/confirm`, { createItem: true }),
    onSuccess: () => { toast.success("Leitura confirmada e peça adicionada"); atualizar(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível confirmar")),
  });

  const gerarAtividade = useMutation({
    mutationFn: () => apiPost<{ message?: string }>(`/parts/${id}/activity`, {}),
    onSuccess: (res) => { toast.success(res.message ?? "Atividade criada"); atualizar(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível gerar a atividade")),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        {!r ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {r.number}
                <Badge variant={STATUS_VARIANT[r.status] ?? "muted"}>{r.statusLabel}</Badge>
                {r.priority !== "NORMAL" && <Badge variant={r.priority === "URGENT" ? "danger" : "warning"}>{PRIORITY_LABEL[r.priority]}</Badge>}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">{r.title}</p>
            </DialogHeader>

            {r.refusalReason && (
              <p className="rounded-md bg-destructive/10 p-3 text-sm">
                <strong>Recusada:</strong> {r.refusalReason}
              </p>
            )}

            <Tabs defaultValue="pecas">
              <TabsList>
                <TabsTrigger value="pecas">Peças ({r.items.length})</TabsTrigger>
                <TabsTrigger value="fotos">Fotos ({r.photos.length})</TabsTrigger>
                <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
                <TabsTrigger value="historico">Histórico ({r.history.length})</TabsTrigger>
              </TabsList>

              <div className="max-h-[50vh] overflow-y-auto pr-1">
                <TabsContent value="pecas" className="space-y-2">
                  {r.items.length === 0 ? (
                    <EmptyState title="Sem peças" description="Adicione ao menos uma peça antes de enviar." />
                  ) : (
                    r.items.map((it) => (
                      <div key={it.id} className="rounded-lg border border-border p-3 text-sm">
                        <p className="font-medium">
                          {it.quantity}× {it.name} {it.code && <span className="font-normal text-muted-foreground">({it.code})</span>}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          L {mm(it.width)} · A {mm(it.height)} · P {mm(it.depth)} · E {mm(it.thickness)}
                        </p>
                        {(it.material || it.color || it.finish) && (
                          <p className="text-xs text-muted-foreground">
                            {[it.material, it.color, it.finish].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        {it.notes && <p className="mt-1 text-xs">{it.notes}</p>}
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="fotos" className="space-y-2">
                  {!r.isFinal && (
                    <>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) enviarFoto.mutate(f);
                          e.target.value = "";
                        }}
                      />
                      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={enviarFoto.isPending}>
                        {enviarFoto.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Tirar foto ou escolher
                      </Button>
                    </>
                  )}
                  {r.photos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma foto. Fotografe a peça e a etiqueta para a equipe entender o pedido.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {r.photos.map((p) => (
                        <div key={p.id} className="rounded-lg border border-border p-2">
                          <a href={`/api/parts/photos/${p.id}/file`} target="_blank" rel="noreferrer">
                            <img src={`/api/parts/photos/${p.id}/file`} alt={p.caption ?? p.fileName} className="h-36 w-full rounded object-cover" />
                          </a>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="truncate text-xs text-muted-foreground">{p.caption ?? p.fileName}</span>
                            {!r.isFinal && (
                              <Button size="sm" variant="ghost" onClick={() => apagarFoto.mutate(p.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          {p.hasOcr && !p.ocrConfirmedAt && (
                            <div className="mt-2 rounded-md bg-warning/10 p-2 text-xs">
                              <p className="mb-1">Leitura da etiqueta pendente de conferência:</p>
                              <p className="font-mono">{p.ocrText?.slice(0, 120) ?? "—"}</p>
                              <Button size="sm" className="mt-2" onClick={() => confirmarLeitura.mutate(p.id)}>
                                <Check className="h-4 w-4" /> Confere — criar peça
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="detalhes" className="space-y-2 text-sm">
                  <Linha rotulo="Ambiente" valor={r.roomLabel ?? "—"} />
                  <Linha rotulo="Montador" valor={r.contractor?.name ?? "—"} />
                  <Linha rotulo="Obra" valor={r.project ? `${r.project.code} · ${r.project.name}` : "—"} />
                  <Linha rotulo="Atividade" valor={r.activity ? `${r.activity.number} · ${r.activity.service}` : "—"} />
                  <Linha rotulo="Criada por" valor={r.createdBy?.name ?? "—"} />
                  <Linha rotulo="Precisa até" valor={dmy(r.neededAt)} />
                  {r.notes && <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3">{r.notes}</p>}
                  {!r.activity && !r.isFinal && (
                    <Button size="sm" variant="outline" onClick={() => gerarAtividade.mutate()} disabled={gerarAtividade.isPending}>
                      <ClipboardList className="h-4 w-4" /> Gerar atividade de montagem
                    </Button>
                  )}
                </TabsContent>

                <TabsContent value="historico" className="space-y-2">
                  {r.history.map((h) => (
                    <div key={h.id} className="border-l-2 border-border pl-3 text-sm">
                      <p>
                        <strong>{h.toLabel}</strong>
                        {h.fromLabel && <span className="text-muted-foreground"> (de {h.fromLabel})</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {h.user?.name ?? "—"} · {new Date(h.createdAt).toLocaleString("pt-BR")}
                      </p>
                      {h.note && <p className="mt-0.5 text-xs">{h.note}</p>}
                    </div>
                  ))}
                </TabsContent>
              </div>
            </Tabs>

            <DialogFooter className="flex-wrap gap-2">
              {r.nextStatuses.map((s) => (
                <Button
                  key={s.status}
                  size="sm"
                  variant={s.status === "RECUSADA" || s.status === "CANCELADA" ? "outline" : "default"}
                  onClick={() => (s.status === "RECUSADA" ? setRecusa(s.status) : mover.mutate({ status: s.status }))}
                  disabled={mover.isPending}
                >
                  {s.status === "ENVIADA" ? <Send className="h-4 w-4" /> : s.status === "CANCELADA" ? <X className="h-4 w-4" /> : null}
                  {s.label}
                </Button>
              ))}
              <Button variant="ghost" onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>

      {/* Recusa exige motivo */}
      {recusa && (
        <Dialog open onOpenChange={() => setRecusa(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Recusar solicitação</DialogTitle>
            </DialogHeader>
            <Campo label="Motivo da recusa *">
              <Textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por que a peça não vai ser produzida?" />
              <p className="text-xs text-muted-foreground">Quem pediu a peça vê este texto.</p>
            </Campo>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRecusa(null)}>Voltar</Button>
              <Button onClick={() => mover.mutate({ status: "RECUSADA", refusalReason: motivo })} disabled={!motivo.trim() || mover.isPending}>
                {mover.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Recusar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p className="flex justify-between gap-3 border-b border-border/60 pb-1">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right">{valor}</span>
    </p>
  );
}

function Campo({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
