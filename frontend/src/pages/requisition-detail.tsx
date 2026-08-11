import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Package } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch } from "@/services/api";
import type { Requisition } from "@/types";
import { formatNumber, UNITS } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { RequisitionStatusBadge } from "@/components/badges";
import { useAuth } from "@/hooks/use-auth";

const ACTIONS: Record<string, { to: string; label: string; permission?: string; tone?: "default" | "success" | "danger" }[]> = {
  PENDING: [
    { to: "IN_REVIEW", label: "Enviar para análise", permission: "requisitions.approve" },
    { to: "CANCELLED", label: "Cancelar", permission: "requisitions.cancel", tone: "danger" },
  ],
  IN_REVIEW: [
    { to: "APPROVED", label: "Aprovar", permission: "requisitions.approve", tone: "success" },
    { to: "REFUSED", label: "Recusar", permission: "requisitions.approve", tone: "danger" },
    { to: "CANCELLED", label: "Cancelar", permission: "requisitions.cancel", tone: "danger" },
  ],
  APPROVED: [
    { to: "SEPARATION", label: "Iniciar separação", permission: "requisitions.separate" },
    { to: "CANCELLED", label: "Cancelar", permission: "requisitions.cancel", tone: "danger" },
  ],
  SEPARATION: [
    { to: "CONCLUDED", label: "Concluir (dar baixa)", permission: "requisitions.finish", tone: "success" },
    { to: "CANCELLED", label: "Cancelar", permission: "requisitions.cancel", tone: "danger" },
  ],
};

export function RequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<{ status: string; label: string; note?: boolean } | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["requisition", id],
    queryFn: () => apiGet<{ data: Requisition }>(`/requisitions/${id}`),
    enabled: Boolean(id),
  });

  const mutation = useMutation({
    mutationFn: ({ status }: { status: string }) => apiPatch(`/requisitions/${id}/status`, { status, note: note || null }),
    onSuccess: () => {
      toast.success("Status atualizado");
      queryClient.invalidateQueries({ queryKey: ["requisition", id] });
      setTarget(null);
      setNote("");
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao atualizar status"),
  });

  if (isLoading) return <TableSkeleton rows={10} cols={5} />;
  if (isError || !data?.data) return <EmptyState title="Erro ao carregar requisição" action={<Button variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button>} />;

  const r = data.data;
  const actions = (ACTIONS[r.status] ?? []).filter((a) => (a.permission ? can(a.permission) : true));
  const needsNote = target?.note;

  const confirmAction = (a: (typeof actions)[number]) => {
    if (a.to === "REFUSED" || a.to === "CANCELLED") {
      setTarget({ status: a.to, label: a.label, note: true });
      setNote("");
    } else {
      setTarget({ status: a.to, label: a.label });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{r.number}</h1>
              <RequisitionStatusBadge status={r.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Solicitada por {r.requester.name} em {new Date(r.createdAt).toLocaleDateString("pt-BR")}
              {r.requester.position ? ` · ${r.requester.position}` : ""}
              {r.approvedBy ? ` · Aprovada por ${r.approvedBy.name}` : ""}
            </p>
          </div>
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button key={a.to} variant={a.tone === "danger" ? "destructive" : a.tone === "success" ? "default" : "outline"} onClick={() => confirmAction(a)}>
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Setor</p>
            <p className="mt-1 font-semibold">{r.sector ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Destino</p>
            <p className="mt-1 font-semibold">{r.destination ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Itens</p>
            <p className="mt-1 font-semibold">{r.itemCount} itens · {formatNumber(r.totalQty)} un.</p>
          </CardContent>
        </Card>
      </div>

      {r.note && (
        <Card>
          <CardContent className="p-5 text-sm">
            <p className="font-medium text-muted-foreground">Observação</p>
            <p className="mt-1">{r.note}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Itens da requisição</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {r.items.length === 0 ? (
            <EmptyState icon={Package} title="Sem itens" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Disponível</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium">{item.product.name}</p>
                      <p className="text-xs text-muted-foreground">{item.product.code}</p>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatNumber(item.quantity)} <span className="text-xs font-normal text-muted-foreground">{UNITS[item.product.unit] ?? item.product.unit}</span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground hidden sm:table-cell">{formatNumber(item.product.stock)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {needsNote && (
              <div className="space-y-2">
                <Label htmlFor="req-note">Justificativa</Label>
                <Textarea id="req-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Informe o motivo" />
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setTarget(null)}>
                Voltar
              </Button>
              <Button
                variant={target?.status === "REFUSED" || target?.status === "CANCELLED" ? "destructive" : "default"}
                onClick={() => target && mutation.mutate({ status: target.status })}
                disabled={mutation.isPending || (needsNote ? note.trim().length < 3 : false)}
              >
                {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
