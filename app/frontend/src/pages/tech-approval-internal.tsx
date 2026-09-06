import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageSkeleton } from "@/components/ui/states";
import { apiGet, apiPatch } from "@/services/api";
import { errorMessage } from "@/lib/utils";

type Approval = {
  id: string;
  status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "CHANGES_REQUESTED";
  termText: string;
  reviewRound: number;
  publishedAt: string | null;
  publishedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  approvedByName: string | null;
  signatureDataUrl: string | null;
  clientComment: string | null;
  document: { id: string; title: string; fileName: string } | null;
};
type DocLite = { id: string; title: string; type: string; fileName: string; visibleToClient: boolean };

const STATUS_LABEL: Record<Approval["status"], string> = {
  DRAFT: "Rascunho", IN_REVIEW: "Aguardando o cliente", APPROVED: "Aprovado", CHANGES_REQUESTED: "Ajustes solicitados",
};
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");

export function TechApprovalInternal({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["tech-approval", "project", projectId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => apiGet<{ data: { approval: Approval; documents: DocLite[] } }>(`/tech-approval/projects/${projectId}`),
  });

  const [term, setTerm] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const serverState = `${data?.data.approval.status}:${data?.data.approval.reviewRound}`;
  useEffect(() => { setTerm(null); setDocId(null); }, [serverState]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch(`/tech-approval/projects/${projectId}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setTerm(null); setDocId(null); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  const act = (action: "publish" | "reopen") =>
    save.mutate(
      { action, ...(term !== null ? { termText: term } : {}), ...(docId !== null ? { documentId: docId || null } : {}) },
      { onSuccess: () => toast.success(action === "publish" ? "Enviado ao cliente" : "Reaberto para edição") }
    );

  if (isLoading) return <PageSkeleton />;
  const a = data?.data.approval;
  const docs = data?.data.documents ?? [];
  if (!a) return <p className="py-8 text-center text-sm text-muted-foreground">Indisponível.</p>;

  const curDoc = docId ?? a.document?.id ?? "";
  const curTerm = term ?? a.termText;
  const dirty = term !== null || docId !== null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>Projeto técnico — aprovação</span>
            <Badge variant={a.status === "APPROVED" ? "success" : a.status === "CHANGES_REQUESTED" ? "warning" : a.status === "IN_REVIEW" ? "secondary" : "muted"}>
              {STATUS_LABEL[a.status]}{a.reviewRound > 1 ? ` · rodada ${a.reviewRound}` : ""}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {a.status === "CHANGES_REQUESTED" && a.clientComment && (
            <div className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              <strong>Cliente pediu ajustes:</strong> {a.clientComment}
            </div>
          )}

          {a.status === "APPROVED" ? (
            <div className="space-y-3 rounded-lg border border-success/40 bg-success/5 p-3">
              <p className="flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="h-4 w-4" /> Aprovado por {a.approvedByName} em {fmtDate(a.approvedAt)}
              </p>
              {a.signatureDataUrl && (
                <img src={a.signatureDataUrl} alt="Assinatura do cliente" className="max-h-24 rounded border border-border bg-white" />
              )}
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                O cliente foi avisado de que alterações a partir daqui podem gerar custo e novo prazo.
              </p>
              {a.document && <p className="text-xs text-muted-foreground">Documento aprovado: {a.document.title}</p>}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Arquivo do projeto técnico (o cliente baixa e revisa)</Label>
                <Select value={curDoc || "NONE"} onValueChange={(v) => setDocId(v === "NONE" ? "" : v)} disabled={!canManage}>
                  <SelectTrigger><SelectValue placeholder="Selecione um documento do projeto" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Nenhum (disponibilizar depois)</SelectItem>
                    {docs.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.title}{!d.visibleToClient ? " (não visível ao cliente)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Envie o 3D/PDF em “Documentos” e marque como visível ao cliente.</p>
              </div>

              <div className="space-y-2">
                <Label>Termo de aprovação</Label>
                <Textarea rows={4} value={curTerm} disabled={!canManage} onChange={(e) => setTerm(e.target.value)} />
              </div>

              {canManage && (
                <div className="flex flex-wrap gap-2">
                  {dirty && (
                    <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ ...(term !== null ? { termText: term } : {}), ...(docId !== null ? { documentId: docId || null } : {}) }, { onSuccess: () => toast.success("Salvo") })}>
                      Salvar
                    </Button>
                  )}
                  {(a.status === "DRAFT" || a.status === "CHANGES_REQUESTED") && (
                    <Button size="sm" disabled={save.isPending} onClick={() => act("publish")}>
                      {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      {a.status === "CHANGES_REQUESTED" ? "Reenviar ao cliente" : "Enviar ao cliente"}
                    </Button>
                  )}
                  {a.status === "IN_REVIEW" && (
                    <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => act("reopen")}>
                      <Undo2 className="mr-2 h-4 w-4" /> Reabrir para edição
                    </Button>
                  )}
                </div>
              )}
              {a.status === "IN_REVIEW" && (
                <p className="text-xs text-muted-foreground">
                  Enviado em {fmtDate(a.publishedAt)}{a.publishedBy ? ` por ${a.publishedBy.name}` : ""} · aguardando o cliente aprovar ou pedir ajustes.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
