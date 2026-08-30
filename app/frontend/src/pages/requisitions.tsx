import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, ClipboardList, Columns3, FileText, List, Loader2, Paperclip, Plus, Search, Trash2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { RequisitionStatusBadge } from "@/components/badges";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ProductPicker } from "@/features/stock/product-picker";
import { useAuth } from "@/hooks/use-auth";
import { formatDate } from "@/lib/utils";
import { apiGet, apiPost, apiUpload } from "@/services/api";
import type { Paginated, Product, Requisition, RequisitionPriority, RequisitionStatus, Unit } from "@/types";

type Indicators = { open: number; inReview: number; waitingMaterial: number; released: number; inCutting: number; inspection: number; completed: number; overdue: number };
type PieceForm = { description: string; material: string; product: Product | null; thickness: string; length: string; width: string; quantity: string; unit: Unit; edgeFinish: string; note: string };
type AttachmentForm = { name: string; url: string; mimeType?: string; size?: number };
const emptyPiece = (): PieceForm => ({ description: "", material: "", product: null, thickness: "", length: "", width: "", quantity: "1", unit: "UNIT", edgeFinish: "", note: "" });
const statuses: { value: string; label: string }[] = [{ value: "ALL", label: "Todos os status" }, { value: "DRAFT", label: "Rascunho" }, { value: "REQUESTED", label: "Solicitada" }, { value: "IN_REVIEW", label: "Em análise" }, { value: "WAITING_MATERIAL", label: "Aguardando material" }, { value: "RELEASED", label: "Liberada" }, { value: "IN_CUTTING", label: "Em corte" }, { value: "INSPECTION", label: "Conferência" }, { value: "COMPLETED", label: "Concluída" }, { value: "CANCELLED", label: "Cancelada" }];
const priorities: { value: RequisitionPriority; label: string }[] = [{ value: "LOW", label: "Baixa" }, { value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "Alta" }, { value: "URGENT", label: "Urgente" }];
const priorityLabel: Record<RequisitionPriority, string> = { LOW: "Baixa", NORMAL: "Normal", HIGH: "Alta", URGENT: "Urgente" };

export function RequisitionsPage() {
  const { can } = useAuth(); const navigate = useNavigate(); const queryClient = useQueryClient();
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [status, setStatus] = useState("ALL"); const [priorityFilter, setPriorityFilter] = useState("ALL"); const [sort, setSort] = useState("newest"); const [myOnly, setMyOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false); const [pickerIndex, setPickerIndex] = useState<number | null>(null); const [pieces, setPieces] = useState<PieceForm[]>([emptyPiece()]);
  const [attachments, setAttachments] = useState<AttachmentForm[]>([]);
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [sector, setSector] = useState(""); const [clientName, setClientName] = useState(""); const [projectReference, setProjectReference] = useState(""); const [priority, setPriority] = useState<RequisitionPriority>("NORMAL"); const [neededAt, setNeededAt] = useState(""); const [note, setNote] = useState("");

  const query = useQuery({ queryKey: ["requisitions", page, search, status, priorityFilter, sort, myOnly], queryFn: () => apiGet<Paginated<Requisition[]>>("/requisitions", { page, perPage: 15, search: search || undefined, status: status === "ALL" ? undefined : status, priority: priorityFilter === "ALL" ? undefined : priorityFilter, sort, my: myOnly ? "true" : undefined }) });
  const indicators = useQuery({ queryKey: ["requisition-indicators"], queryFn: () => apiGet<{ data: Indicators }>("/requisitions/indicators") });
  const board = useQuery({ queryKey: ["cutting-board"], enabled: can("requisitions.cut"), queryFn: () => apiGet<{ data: Requisition[] }>("/requisitions/cutting-board") });

  const resetForm = () => { setPieces([emptyPiece()]); setAttachments([]); setSector(""); setClientName(""); setProjectReference(""); setPriority("NORMAL"); setNeededAt(""); setNote(""); };
  const create = useMutation({ mutationFn: (submit: boolean) => apiPost<{ data: Requisition }>("/requisitions", { sector: sector || null, clientName: clientName || null, projectReference: projectReference || null, priority, neededAt: neededAt ? new Date(`${neededAt}T12:00:00`).toISOString() : null, note: note || null, submit, attachments: attachments.filter((item) => item.name && item.url), items: pieces.map((piece) => ({ description: piece.description, material: piece.material || null, productId: piece.product?.id ?? null, thickness: piece.thickness ? Number(piece.thickness) : null, length: piece.length ? Number(piece.length) : null, width: piece.width ? Number(piece.width) : null, quantity: Number(piece.quantity), unit: piece.unit, edgeFinish: piece.edgeFinish || null, note: piece.note || null })) }), onSuccess: (res) => { toast.success("Requisição criada"); void queryClient.invalidateQueries({ queryKey: ["requisitions"] }); void queryClient.invalidateQueries({ queryKey: ["requisition-indicators"] }); setDialogOpen(false); resetForm(); navigate(`/requisicoes/${res.data.id}`); }, onError: (error) => toast.error((error as Error).message) });
  const submit = (send: boolean) => { if (pieces.some((piece) => piece.description.trim().length < 2 || !Number.isInteger(Number(piece.quantity)) || Number(piece.quantity) <= 0)) return toast.error("Preencha a descrição e a quantidade de todas as peças"); create.mutate(send); };
  const patchPiece = (index: number, patch: Partial<PieceForm>) => setPieces((current) => current.map((piece, i) => i === index ? { ...piece, ...patch } : piece));
  const uploadAttachments = async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length) return;
    setIsUploadingAttachment(true);
    try {
      const uploaded = await Promise.all(selected.map((file) => apiUpload<{ data: AttachmentForm }>("/requisitions/attachments", file)));
      setAttachments((current) => [...current, ...uploaded.map((result) => result.data)]);
      toast.success(`${selected.length} ${selected.length === 1 ? "arquivo anexado" : "arquivos anexados"}`);
    } catch (error) {
      toast.error((error as Error).message || "Não foi possível enviar o arquivo");
    } finally {
      setIsUploadingAttachment(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  };
  const rows = query.data?.data ?? []; const metrics = indicators.data?.data;
  const boardColumns: { status: RequisitionStatus; label: string }[] = [{ status: "RELEASED", label: "Liberadas" }, { status: "IN_CUTTING", label: "Em corte" }, { status: "INSPECTION", label: "Conferência" }, { status: "COMPLETED", label: "Concluídas" }];

  return <div className="space-y-6">
    <PageHeader title="Requisições de Peças" description="Solicitação, disponibilidade de materiais e acompanhamento do corte.">{can("requisitions.create") && <Button onClick={() => { resetForm(); setDialogOpen(true); }}><Plus className="h-4 w-4" />Nova Requisição</Button>}</PageHeader>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      <KpiCard title="Abertas" value={metrics?.open ?? 0} icon={ClipboardList} />
      <KpiCard title="Em análise" value={metrics?.inReview ?? 0} icon={Search} />
      <KpiCard title="Aguard. material" value={metrics?.waitingMaterial ?? 0} icon={AlertTriangle} />
      <KpiCard title="Liberadas" value={metrics?.released ?? 0} icon={ClipboardList} />
      <KpiCard title="Em corte" value={metrics?.inCutting ?? 0} icon={Columns3} />
      <KpiCard title="Conferência" value={metrics?.inspection ?? 0} icon={ClipboardList} />
      <KpiCard title="Concluídas" value={metrics?.completed ?? 0} icon={ClipboardList} />
      <KpiCard title="Atrasadas" value={metrics?.overdue ?? 0} icon={CalendarClock} />
    </div>

    <Tabs defaultValue="list"><TabsList><TabsTrigger value="list"><List className="mr-2 h-4 w-4" />Lista</TabsTrigger>{can("requisitions.cut") && <TabsTrigger value="board"><Columns3 className="mr-2 h-4 w-4" />Painel de corte</TabsTrigger>}</TabsList>
      <TabsContent value="list" className="space-y-4">
        <Card><CardContent className="grid gap-3 pt-6 md:grid-cols-5"><div className="relative md:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Número, cliente, projeto ou peça" /></div><Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Select value={priorityFilter} onValueChange={setPriorityFilter}><SelectTrigger><SelectValue placeholder="Prioridade" /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas as prioridades</SelectItem>{priorities.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Select value={sort} onValueChange={setSort}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newest">Mais recentes</SelectItem><SelectItem value="oldest">Mais antigas</SelectItem><SelectItem value="deadline">Prazo</SelectItem><SelectItem value="priority">Prioridade</SelectItem></SelectContent></Select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={myOnly} onChange={(e) => setMyOnly(e.target.checked)} />Somente minhas</label></CardContent></Card>
        <Card><CardContent className="p-0">{query.isLoading ? <div className="p-4"><TableSkeleton rows={6} /></div> : rows.length === 0 ? <EmptyState icon={ClipboardList} title="Nenhuma requisição encontrada" description="Crie uma requisição ou ajuste os filtros." /> : <Table><TableHeader><TableRow><TableHead>Número</TableHead><TableHead>Cliente / projeto</TableHead><TableHead>Status</TableHead><TableHead>Prioridade</TableHead><TableHead>Peças</TableHead><TableHead>Prazo</TableHead><TableHead>Solicitante</TableHead></TableRow></TableHeader><TableBody>{rows.map((req) => <TableRow key={req.id} className="cursor-pointer" onClick={() => navigate(`/requisicoes/${req.id}`)}><TableCell className="font-medium">{req.number}{req.overdue && <span className="ml-2 text-xs text-destructive">Atrasada</span>}</TableCell><TableCell>{req.clientName || "—"}<span className="block text-xs text-muted-foreground">{req.projectReference || "Sem projeto"}</span></TableCell><TableCell><RequisitionStatusBadge status={req.status} /></TableCell><TableCell>{priorityLabel[req.priority]}</TableCell><TableCell>{req.totalQty} ({req.progress}%)</TableCell><TableCell>{req.neededAt ? formatDate(req.neededAt) : "—"}</TableCell><TableCell>{req.requester.name}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
        {query.data?.meta && <Pagination page={query.data.meta.page} pages={query.data.meta.pages} total={query.data.meta.total} perPage={query.data.meta.perPage} onChange={setPage} />}
      </TabsContent>
      <TabsContent value="board"><div className="grid gap-4 xl:grid-cols-4">{boardColumns.map((column) => <div key={column.status} className="rounded-xl bg-muted/40 p-3"><h3 className="mb-3 flex items-center justify-between font-semibold">{column.label}<span className="rounded-full bg-background px-2 py-0.5 text-xs">{board.data?.data.filter((req) => req.status === column.status).length ?? 0}</span></h3><div className="space-y-3">{board.data?.data.filter((req) => req.status === column.status).map((req) => <Card key={req.id} className="cursor-pointer hover:border-primary/50" onClick={() => navigate(`/requisicoes/${req.id}`)}><CardContent className="space-y-2 p-4"><div className="flex justify-between"><strong>{req.number}</strong><span className="text-xs">{priorityLabel[req.priority]}</span></div><p className="text-sm">{req.clientName || req.projectReference || "Sem cliente/projeto"}</p><p className="text-xs text-muted-foreground">{req.totalQty} peças · {req.neededAt ? formatDate(req.neededAt) : "Sem prazo"}</p><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${req.progress}%` }} /></div><p className="text-xs">{req.responsible?.name || req.cutter?.name || "Sem responsável"}</p></CardContent></Card>)}</div></div>)}</div></TabsContent>
    </Tabs>

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>Nova Requisição de Peças</DialogTitle></DialogHeader><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"><div><Label>Solicitante</Label><Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Nome do solicitante" /></div><div><Label>Cliente</Label><Input value={clientName} onChange={(e) => setClientName(e.target.value)} /></div><div><Label>Projeto/pedido</Label><Input value={projectReference} onChange={(e) => setProjectReference(e.target.value)} /></div><div><Label>Data necessária</Label><Input type="date" value={neededAt} onChange={(e) => setNeededAt(e.target.value)} /></div><div><Label>Prioridade</Label><Select value={priority} onValueChange={(value) => setPriority(value as RequisitionPriority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{priorities.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div><div className="md:col-span-2 lg:col-span-3"><Label>Observações</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div></div>
      <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">Peças</h3><Button type="button" size="sm" variant="outline" onClick={() => setPieces((current) => [...current, emptyPiece()])}><Plus className="h-4 w-4" />Adicionar peça</Button></div>{pieces.map((piece, index) => <Card key={index}><CardHeader className="flex-row items-center justify-between py-3"><CardTitle className="text-sm">Peça {index + 1}</CardTitle><Button type="button" size="icon" variant="ghost" disabled={pieces.length === 1} onClick={() => setPieces((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></CardHeader><CardContent className="grid gap-3 md:grid-cols-4"><div className="md:col-span-2"><Label>Nome/descrição *</Label><Input value={piece.description} onChange={(e) => patchPiece(index, { description: e.target.value })} /></div><div><Label>Material</Label><Input value={piece.material} onChange={(e) => patchPiece(index, { material: e.target.value })} /></div><div><Label>Produto do estoque</Label><Button type="button" variant="outline" className="w-full justify-start overflow-hidden" onClick={() => setPickerIndex(index)}>{piece.product ? piece.product.name : "Associar produto"}</Button></div><div><Label>Espessura (mm)</Label><Input type="number" min="0" value={piece.thickness} onChange={(e) => patchPiece(index, { thickness: e.target.value })} /></div><div><Label>Comprimento (mm)</Label><Input type="number" min="0" value={piece.length} onChange={(e) => patchPiece(index, { length: e.target.value })} /></div><div><Label>Largura (mm)</Label><Input type="number" min="0" value={piece.width} onChange={(e) => patchPiece(index, { width: e.target.value })} /></div><div><Label>Quantidade *</Label><Input type="number" min="1" step="1" value={piece.quantity} onChange={(e) => patchPiece(index, { quantity: e.target.value })} /></div><div className="md:col-span-2"><Label>Acabamento/fita de borda</Label><Input value={piece.edgeFinish} onChange={(e) => patchPiece(index, { edgeFinish: e.target.value })} /></div><div className="md:col-span-2"><Label>Observação da peça</Label><Input value={piece.note} onChange={(e) => patchPiece(index, { note: e.target.value })} /></div></CardContent></Card>)}</div>
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 font-semibold"><Paperclip className="h-4 w-4" />Anexos</h3>
        <input ref={attachmentInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="sr-only" onChange={(event) => void uploadAttachments(event.target.files ?? [])} />
        <button
          type="button"
          className={`flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${isDraggingAttachment ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30"}`}
          onClick={() => attachmentInputRef.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setIsDraggingAttachment(true); }}
          onDragOver={(event) => { event.preventDefault(); setIsDraggingAttachment(true); }}
          onDragLeave={(event) => { event.preventDefault(); setIsDraggingAttachment(false); }}
          onDrop={(event) => { event.preventDefault(); setIsDraggingAttachment(false); void uploadAttachments(event.dataTransfer.files); }}
          disabled={isUploadingAttachment}
        >
          {isUploadingAttachment ? <Loader2 className="mb-2 h-8 w-8 animate-spin text-primary" /> : <UploadCloud className="mb-2 h-8 w-8 text-primary" />}
          <span className="font-medium">{isUploadingAttachment ? "Enviando arquivos..." : "Arraste e solte os arquivos aqui"}</span>
          <span className="mt-1 text-sm text-muted-foreground">ou clique para procurar arquivos e fotos no dispositivo</span>
          <span className="mt-2 text-xs text-muted-foreground">Imagens, PDF, Word, Excel, CSV ou TXT — até 10 MB por arquivo</span>
        </button>
        {attachments.map((attachment, index) => <div key={`${attachment.url}-${index}`} className="flex items-center gap-3 rounded-md border p-3"><FileText className="h-5 w-5 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{attachment.name}</p>{attachment.size != null && <p className="text-xs text-muted-foreground">{(attachment.size / 1024 / 1024).toFixed(2)} MB</p>}</div><Button type="button" size="icon" variant="ghost" aria-label={`Remover ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>)}
      </div>
      <DialogFooter><Button variant="outline" disabled={create.isPending} onClick={() => submit(false)}>Salvar rascunho</Button><Button disabled={create.isPending} onClick={() => submit(true)}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Criar e enviar</Button></DialogFooter></DialogContent></Dialog>
    <ProductPicker open={pickerIndex !== null} onOpenChange={(open) => { if (!open) setPickerIndex(null); }} onSelect={(product) => { if (pickerIndex !== null) patchPiece(pickerIndex, { product, material: pieces[pickerIndex].material || product.name, unit: product.unit }); setPickerIndex(null); }} />
  </div>;
}
