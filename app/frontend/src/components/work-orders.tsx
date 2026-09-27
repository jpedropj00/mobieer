import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Plus, Printer, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiObjectUrl, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type WorkOrder = {
  id: string;
  number: string;
  status: "OPEN" | "DONE" | "CANCELLED";
  scheduledFor: string | null;
  instructions: string | null;
  receivedByName: string | null;
  completedAt: string | null;
  createdAt: string;
  project: { id: string; code: string; name: string };
  client: { name: string };
  contractor: { id: string; name: string };
  tasks: { id: string; name: string; status: string }[];
  progress: { total: number; done: number };
  link?: string;
};

const STATUS: Record<WorkOrder["status"], { label: string; variant: "secondary" | "success" | "muted" }> = {
  OPEN: { label: "Aberta", variant: "secondary" },
  DONE: { label: "Concluída", variant: "success" },
  CANCELLED: { label: "Cancelada", variant: "muted" },
};

/** Abre a folha (PDF com o QR) numa aba nova para imprimir. */
async function openPdf(id: string) {
  const win = window.open("", "_blank");
  try {
    const url = await apiObjectUrl(`/work-orders/${id}/pdf`);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (e) {
    win?.close();
    toast.error(errorMessage(e, "Falha ao gerar a folha"));
  }
}

/** Aba "Requisições" dos montadores externos: folha impressa com QR, sem papel de volta. */
export function WorkOrdersTab({ contractors, projects }: { contractors: { id: string; name: string; active: boolean }[]; projects: { id: string; name: string; code?: string }[] }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"OPEN" | "DONE" | "CANCELLED" | "ALL">("OPEN");
  const [creating, setCreating] = useState(false);
  const [showLink, setShowLink] = useState<WorkOrder | null>(null);
  const q = useQuery({
    queryKey: ["work-orders", status],
    queryFn: () => apiGet<{ data: WorkOrder[] }>("/work-orders", status === "ALL" ? undefined : { status }),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "cancel" | "new-link" }) => apiPost<{ data: WorkOrder; message: string }>(`/work-orders/${id}/${action}`),
    onSuccess: (r, v) => {
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      if (v.action === "new-link") setShowLink(r.data);
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível concluir")),
  });
  const rows = q.data?.data ?? [];
  const manage = can("hr.employees.manage");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {manage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Nova requisição
          </Button>
        )}
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="OPEN">Abertas</SelectItem>
            <SelectItem value="DONE">Concluídas</SelectItem>
            <SelectItem value="CANCELLED">Canceladas</SelectItem>
            <SelectItem value="ALL">Todas</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Imprima a folha e entregue ao montador: ele escaneia o QR, conclui os cômodos no celular e colhe a assinatura do cliente na tela.</p>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhuma requisição" description="Crie uma requisição para imprimir a folha com o QR da montagem." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requisição</TableHead>
                  <TableHead>Obra</TableHead>
                  <TableHead>Montador</TableHead>
                  <TableHead>Cômodos</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <span className="font-medium">{o.number}</span>
                      <span className="block text-xs text-muted-foreground">{o.scheduledFor ? `prevista ${formatDate(o.scheduledFor)}` : `emitida ${formatDate(o.createdAt)}`}</span>
                    </TableCell>
                    <TableCell>
                      {o.project.code} — {o.project.name}
                      <span className="block text-xs text-muted-foreground">{o.client.name}</span>
                    </TableCell>
                    <TableCell>{o.contractor.name}</TableCell>
                    <TableCell>
                      {o.progress.done}/{o.progress.total}
                      <span className="block text-xs text-muted-foreground">{o.tasks.map((t) => t.name).join(", ")}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS[o.status].variant}>{STATUS[o.status].label}</Badge>
                      {o.receivedByName && <span className="block text-xs text-muted-foreground">recebido por {o.receivedByName} em {formatDate(o.completedAt)}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {o.status === "OPEN" && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => void openPdf(o.id)}><Printer className="mr-1 h-4 w-4" /> Imprimir</Button>
                          {manage && (
                            <>
                              <Button size="icon" variant="ghost" title="Gerar novo QR (folha perdida)" disabled={act.isPending} onClick={() => confirm("A folha impressa deixa de valer. Gerar novo QR?") && act.mutate({ id: o.id, action: "new-link" })}>
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" className="text-destructive" title="Cancelar" disabled={act.isPending} onClick={() => confirm(`Cancelar ${o.number}? O QR deixa de valer.`) && act.mutate({ id: o.id, action: "cancel" })}>
                                <Ban className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {creating && (
        <CreateDialog
          contractors={contractors.filter((c) => c.active)}
          projects={projects}
          onClose={() => setCreating(false)}
          onCreated={(o) => {
            setCreating(false);
            setShowLink(o);
            qc.invalidateQueries({ queryKey: ["work-orders"] });
          }}
        />
      )}
      {showLink && (
        <Dialog open onOpenChange={(v) => !v && setShowLink(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Requisição {showLink.number}</DialogTitle></DialogHeader>
            <p className="text-sm">Imprima a folha e entregue ao montador. Se preferir, mande o link pelo WhatsApp:</p>
            <Input readOnly value={showLink.link ?? ""} onFocus={(e) => e.currentTarget.select()} />
            <DialogFooter>
              <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(showLink.link ?? ""); toast.success("Link copiado"); }}>
                <QrCode className="mr-1 h-4 w-4" /> Copiar link
              </Button>
              <Button onClick={() => void openPdf(showLink.id)}><Printer className="mr-1 h-4 w-4" /> Imprimir folha</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CreateDialog({ contractors, projects, onClose, onCreated }: { contractors: { id: string; name: string }[]; projects: { id: string; name: string; code?: string }[]; onClose: () => void; onCreated: (o: WorkOrder) => void }) {
  const [projectId, setProjectId] = useState("");
  const [contractorId, setContractorId] = useState("");
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [rooms, setRooms] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [instructions, setInstructions] = useState("");
  const pending = useQuery({
    queryKey: ["work-orders", "pending-tasks", projectId, contractorId],
    queryFn: () => apiGet<{ data: { id: string; name: string; status: string }[] }>("/work-orders/pending-tasks", { projectId, contractorId }),
    enabled: Boolean(projectId && contractorId),
  });
  const save = useMutation({
    mutationFn: () =>
      apiPost<{ data: WorkOrder; message: string }>("/work-orders", {
        projectId,
        contractorId,
        taskIds,
        rooms: rooms.split("\n").map((r) => r.trim()).filter(Boolean),
        scheduledFor: scheduledFor || null,
        instructions: instructions || null,
      }),
    onSuccess: (r) => {
      toast.success(r.message);
      onCreated(r.data);
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao criar a requisição")),
  });
  const newRooms = rooms.split("\n").filter((r) => r.trim()).length;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Nova requisição de montagem</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label>Obra</Label>
            <Select value={projectId || "NONE"} onValueChange={(v) => { setProjectId(v === "NONE" ? "" : v); setTaskIds([]); }}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Selecione</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ""}{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Montador</Label>
            <Select value={contractorId || "NONE"} onValueChange={(v) => { setContractorId(v === "NONE" ? "" : v); setTaskIds([]); }}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Selecione</SelectItem>
                {contractors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(pending.data?.data ?? []).length > 0 && (
            <div className="space-y-1.5">
              <Label>Cômodos já lançados para ele nesta obra</Label>
              {pending.data!.data.map((t) => (
                <label key={t.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={taskIds.includes(t.id)} onChange={(e) => setTaskIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))} />
                  {t.name}
                </label>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Cômodos novos (um por linha)</Label>
            <Textarea rows={3} placeholder={"Cozinha\nBanheiro da suíte\nDormitório casal"} value={rooms} onChange={(e) => setRooms(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Data prevista</Label>
            <Input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Instruções para o montador</Label>
            <Textarea rows={3} placeholder="Horário da portaria, ferramentas, cuidados…" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!projectId || !contractorId || (!taskIds.length && !newRooms) || save.isPending} onClick={() => save.mutate()}>Criar requisição</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
