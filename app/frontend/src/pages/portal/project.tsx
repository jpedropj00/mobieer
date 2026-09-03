import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, ExternalLink, FileSignature, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SignaturePad } from "@/components/signature-pad";
import { errorMessage } from "@/lib/utils";
import { portalDownload, portalGet, portalPost } from "@/services/portal-api";

type Doc = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  fileName: string;
  sizeBytes: number;
  version: number;
  createdAt: string;
  downloadUrl: string;
  requiresSignature: boolean;
  signatureStatus: "NOT_REQUIRED" | "PENDING" | "SIGNED";
  clientSigned: boolean;
  canClientSign: boolean;
};
type Assistance = {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  origin: string;
  createdAt: string;
  resolvedAt: string | null;
};
type ProjectDetail = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  startAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  feedbackFormUrl: string | null;
  manager: { name: string } | null;
  documents: Doc[];
  assistances: Assistance[];
};

const STATUS_LABEL: Record<string, string> = {
  PLANNING: "Planejamento", ACTIVE: "Em andamento", ON_HOLD: "Pausado", COMPLETED: "Concluído", CANCELLED: "Cancelado",
  OPEN: "Aberto", TRIAGE: "Triagem", SCHEDULED: "Agendado", IN_PROGRESS: "Em andamento", WAITING_CLIENT: "Aguardando você", RESOLVED: "Resolvido", CANCELLED_ASSIST: "Cancelado",
};
const DOC_LABEL: Record<string, string> = {
  MANUAL_GARANTIA: "Manual e Garantia",
  VISTORIA_CHECKLIST: "Vistoria Técnica",
  CRONOGRAMA: "Cronograma",
  VISTORIA_FOTOGRAFICA: "Vistoria Fotográfica",
  CONTRATO: "Contrato",
  PROJETO_3D: "Projeto 3D",
  OUTRO: "Documento",
};

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function DocRow({ doc, projectId }: { doc: Doc; projectId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [name, setName] = useState("");
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await portalPost(`/documents/${doc.id}/sign`, { signerName: name, dataUrl });
      toast.success("Assinatura registrada");
      setSigning(false);
      setName("");
      setDataUrl(null);
      qc.invalidateQueries({ queryKey: ["portal", "project", projectId] });
    } catch (err) {
      toast.error(errorMessage(err, "Falha ao assinar"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {doc.title}
          {doc.requiresSignature && (
            <Badge className="ml-2 align-middle" variant={doc.signatureStatus === "SIGNED" ? "success" : "warning"}>
              {doc.signatureStatus === "SIGNED" ? "Assinado" : doc.clientSigned ? "Aguardando outras assinaturas" : "Assinatura pendente"}
            </Badge>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {DOC_LABEL[doc.type] ?? "Documento"} · {fmtSize(doc.sizeBytes)}
          {doc.version > 1 ? ` · v${doc.version}` : ""} · {fmtDate(doc.createdAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {doc.canClientSign && (
          <Button size="sm" variant="outline" onClick={() => setSigning(true)}>
            <FileSignature className="mr-1 h-4 w-4" /> Assinar
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await portalDownload(doc.downloadUrl.replace("/api/portal", ""), doc.fileName);
            } catch (err) {
              toast.error(errorMessage(err, "Falha ao baixar"));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </Button>
      </div>

      <Dialog open={signing} onOpenChange={setSigning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assinar — {doc.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Seu nome completo</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <SignaturePad onChange={setDataUrl} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSigning(false)}>Cancelar</Button>
            <Button disabled={saving || name.trim().length < 2 || !dataUrl} onClick={submit}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar assinatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocList({ docs, empty, projectId }: { docs: Doc[]; empty: string; projectId: string }) {
  if (docs.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return <div className="space-y-2">{docs.map((d) => <DocRow key={d.id} doc={d} projectId={projectId} />)}</div>;
}

export function PortalProjectPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["portal", "project", id],
    queryFn: () => portalGet<{ data: ProjectDetail }>(`/projects/${id}`),
  });

  const [form, setForm] = useState({ title: "", description: "" });
  const openTicket = useMutation({
    mutationFn: () => portalPost("/assistances", { ...form, projectId: id }),
    onSuccess: () => {
      toast.success("Chamado aberto. Nossa equipe entrará em contato.");
      setForm({ title: "", description: "" });
      qc.invalidateQueries({ queryKey: ["portal", "project", id] });
    },
    onError: (err) => toast.error(errorMessage(err, "Não foi possível abrir o chamado")),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!data?.data) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Projeto não encontrado.</p>;
  }

  const p = data.data;
  const byType = (t: string) => p.documents.filter((d) => d.type === t);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/portal" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Projetos
        </Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-muted-foreground">Contrato {p.code}</p>
            <h1 className="text-xl font-semibold">{p.name}</h1>
          </div>
          <Badge variant="secondary">{STATUS_LABEL[p.status] ?? p.status}</Badge>
        </div>
      </div>

      <Tabs defaultValue="cronograma">
        <TabsList className="flex-wrap">
          <TabsTrigger value="cronograma">Cronograma</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="fotos">Fotos</TabsTrigger>
          <TabsTrigger value="garantia">Garantia</TabsTrigger>
          <TabsTrigger value="avaliacao">Avaliação</TabsTrigger>
          <TabsTrigger value="assistencia">Assistência</TabsTrigger>
        </TabsList>

        <TabsContent value="cronograma" className="space-y-4">
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Início</p><p className="font-medium">{fmtDate(p.startAt)}</p></div>
              <div><p className="text-xs text-muted-foreground">Previsão de término</p><p className="font-medium">{fmtDate(p.dueAt)}</p></div>
              <div><p className="text-xs text-muted-foreground">Concluído em</p><p className="font-medium">{fmtDate(p.completedAt)}</p></div>
              {p.manager && <div><p className="text-xs text-muted-foreground">Responsável</p><p className="font-medium">{p.manager.name}</p></div>}
            </CardContent>
          </Card>
          {p.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{p.description}</p>}
          <DocList docs={byType("CRONOGRAMA")} empty="Cronograma detalhado ainda não publicado." projectId={p.id} />
        </TabsContent>

        <TabsContent value="documentos">
          <DocList docs={p.documents} empty="Nenhum documento disponível." projectId={p.id} />
        </TabsContent>

        <TabsContent value="fotos">
          <DocList docs={byType("VISTORIA_FOTOGRAFICA")} empty="Vistoria fotográfica ainda não disponível." projectId={p.id} />
        </TabsContent>

        <TabsContent value="garantia" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Resumo da garantia</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Estrutura e montagem: <strong className="text-foreground">5 anos</strong></p>
              <p>Ferragens (dobradiças, corrediças, roldanas, pistões): <strong className="text-foreground">5 anos</strong></p>
              <p>Puxadores: <strong className="text-foreground">2 anos</strong> · Aramados: <strong className="text-foreground">1 ano</strong></p>
              <p className="pt-1 text-xs">Consulte o documento completo para condições e exclusões.</p>
            </CardContent>
          </Card>
          <DocList docs={byType("MANUAL_GARANTIA")} empty="Certificado de garantia ainda não disponível." projectId={p.id} />
        </TabsContent>

        <TabsContent value="avaliacao" className="space-y-3">
          {p.feedbackFormUrl ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">Sua opinião ajuda a Mobieer a melhorar.</p>
                <a href={p.feedbackFormUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline"><ExternalLink className="mr-2 h-4 w-4" />Abrir em nova aba</Button>
                </a>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <iframe
                  title="Formulário de avaliação"
                  src={`${p.feedbackFormUrl}${p.feedbackFormUrl.includes("?") ? "&" : "?"}embedded=true`}
                  className="h-[70vh] w-full"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                O formulário é hospedado pelo Google e pode usar cookies próprios.
              </p>
            </>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">Formulário de avaliação ainda não configurado.</p>
          )}
        </TabsContent>

        <TabsContent value="assistencia" className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Abrir um chamado</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="t-title">Assunto</Label>
                <Input id="t-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Ajuste em porta do armário" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-desc">Descrição</Label>
                <Textarea id="t-desc" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descreva o que precisa de atenção" />
              </div>
              <Button
                disabled={openTicket.isPending || form.title.trim().length < 3 || form.description.trim().length < 5}
                onClick={() => openTicket.mutate()}
              >
                {openTicket.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar chamado
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Seus chamados</h3>
            {p.assistances.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nenhum chamado neste projeto.</p>
            ) : (
              p.assistances.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.number} — {a.title}</p>
                    <p className="text-xs text-muted-foreground">Aberto em {fmtDate(a.createdAt)}</p>
                  </div>
                  <Badge variant="secondary">{STATUS_LABEL[a.status] ?? a.status}</Badge>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
