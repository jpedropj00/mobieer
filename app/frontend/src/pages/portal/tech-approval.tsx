import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Download, FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SignaturePad } from "@/components/signature-pad";
import { errorMessage } from "@/lib/utils";
import { portalDownload, portalGet, portalPost } from "@/services/portal-api";

type Approval = {
  id: string;
  status: "IN_REVIEW" | "APPROVED" | "CHANGES_REQUESTED";
  termText: string;
  reviewRound: number;
  publishedAt: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  clientComment: string | null;
  document: { id: string; title: string; fileName: string; sizeBytes: number } | null;
};

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function PortalTechApproval({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const key = ["portal", "tech-approval", projectId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => portalGet<{ data: Approval | null }>(`/projects/${projectId}/tech-approval`),
  });

  const [dlg, setDlg] = useState<null | "approve" | "changes">(null);
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busyDoc, setBusyDoc] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["portal", "project", projectId] });
  };
  const approve = useMutation({
    mutationFn: () => portalPost(`/projects/${projectId}/tech-approval/approve`, { approvedByName: name, signatureDataUrl: sig }),
    onSuccess: () => { toast.success("Projeto técnico aprovado!"); setDlg(null); setName(""); setSig(null); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao aprovar")),
  });
  const requestChanges = useMutation({
    mutationFn: () => portalPost(`/projects/${projectId}/tech-approval/request-changes`, { comment }),
    onSuccess: () => { toast.success("Pedido de ajustes enviado"); setDlg(null); setComment(""); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao enviar")),
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  const a = data?.data ?? null;

  if (!a) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
          <Clock className="h-5 w-5" />
          O projeto técnico ainda não foi liberado para sua aprovação. Você será avisado quando estiver pronto.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>Projeto técnico</span>
            <Badge variant={a.status === "APPROVED" ? "success" : a.status === "CHANGES_REQUESTED" ? "warning" : "secondary"}>
              {a.status === "APPROVED" ? "Aprovado" : a.status === "CHANGES_REQUESTED" ? "Ajustes solicitados" : "Aguardando sua aprovação"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {a.document ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{a.document.title}</p>
                <p className="text-xs text-muted-foreground">{a.document.fileName} · {fmtSize(a.document.sizeBytes)}</p>
              </div>
              <Button
                size="sm" variant="outline" disabled={busyDoc}
                onClick={async () => {
                  setBusyDoc(true);
                  try { await portalDownload(`/documents/${a.document!.id}/download`, a.document!.fileName); }
                  catch (e) { toast.error(errorMessage(e, "Falha ao baixar")); }
                  finally { setBusyDoc(false); }
                }}
              >
                {busyDoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">O arquivo do projeto será disponibilizado pela equipe.</p>
          )}

          {a.status === "CHANGES_REQUESTED" && a.clientComment && (
            <div className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              Você pediu: “{a.clientComment}”. A equipe está trabalhando nos ajustes.
            </div>
          )}

          {a.status === "APPROVED" ? (
            <div className="space-y-2 rounded-lg border border-success/40 bg-success/5 p-3">
              <p className="flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="h-4 w-4" /> Aprovado por {a.approvedByName} em {fmtDate(a.approvedAt)}
              </p>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                A partir da aprovação, alterações no projeto podem gerar custo adicional e novo prazo de produção e entrega.
              </p>
            </div>
          ) : a.status === "IN_REVIEW" ? (
            <>
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Termo de aprovação</p>
                <p className="whitespace-pre-line text-sm">{a.termText}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => { setName(""); setSig(null); setDlg("approve"); }}>
                  <FileCheck2 className="mr-2 h-4 w-4" /> Aprovar e assinar
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setComment(""); setDlg("changes"); }}>
                  Pedir ajustes
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={dlg === "approve"} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Aprovar projeto técnico</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="whitespace-pre-line rounded-md bg-muted/50 p-3 text-xs">{a.termText}</p>
            <div className="space-y-2">
              <Label>Seu nome completo</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <SignaturePad onChange={setSig} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Cancelar</Button>
            <Button disabled={approve.isPending || name.trim().length < 2 || !sig} onClick={() => approve.mutate()}>
              {approve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Aprovar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === "changes"} onOpenChange={(v) => !v && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pedir ajustes no projeto</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>O que precisa ser ajustado?</Label>
            <Textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Descreva os pontos que devem mudar" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Cancelar</Button>
            <Button disabled={requestChanges.isPending || comment.trim().length < 3} onClick={() => requestChanges.mutate()}>
              {requestChanges.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
