import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, FileSignature, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SignaturePad } from "@/components/signature-pad";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiDelete, apiDownload, apiGet, apiPatch, apiPost, apiPostForm } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/utils";

type Project = {
  id: string;
  code: string;
  name: string;
  status: string;
  feedbackFormUrl: string | null;
  client: { id: string; name: string };
  manager: { id: string; name: string } | null;
  _count: { assistances: number; kanbanTasks: number; documents: number };
};
type Doc = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  fileName: string;
  sizeBytes: number;
  visibleToClient: boolean;
  requiresSignature: boolean;
  signerRoles: string[];
  signatureStatus: "NOT_REQUIRED" | "PENDING" | "SIGNED";
  signatures: { id: string; role: string; signerName: string; signedAt: string }[];
  version: number;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
};
type Account = {
  id: string;
  name: string;
  email: string;
  status: "INVITED" | "ACTIVE" | "DISABLED";
  lastLogin: string | null;
  inviteExpiry: string | null;
  createdAt: string;
};

const DOC_TYPES = [
  ["MANUAL_GARANTIA", "Manual e Garantia"],
  ["VISTORIA_CHECKLIST", "Vistoria Técnica"],
  ["CRONOGRAMA", "Cronograma"],
  ["VISTORIA_FOTOGRAFICA", "Vistoria Fotográfica"],
  ["CONTRATO", "Contrato"],
  ["PROJETO_3D", "Projeto 3D"],
  ["OUTRO", "Outro"],
] as const;
const DOC_LABEL = Object.fromEntries(DOC_TYPES) as Record<string, string>;
const ACCOUNT_LABEL: Record<Account["status"], string> = { INVITED: "Convidado", ACTIVE: "Ativo", DISABLED: "Desativado" };

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function ProjectDetailPage() {
  const { projectId = "" } = useParams();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("documents.manage");
  const canManageAccounts = can("organization.manage");

  const project = useQuery({ queryKey: ["project", projectId], queryFn: () => apiGet<{ data: Project }>(`/business/projects/${projectId}`) });
  const docs = useQuery({ queryKey: ["project-docs", projectId], queryFn: () => apiGet<{ data: Doc[] }>("/documents", { projectId }) });
  const clientId = project.data?.data.client.id;
  const accounts = useQuery({
    queryKey: ["client-accounts", clientId],
    queryFn: () => apiGet<{ data: Account[] }>(`/business/clients/${clientId}/accounts`),
    enabled: Boolean(clientId) && canManageAccounts,
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState({ type: "OUTRO", title: "", visibleToClient: true });
  const [file, setFile] = useState<File | null>(null);
  const [invite, setInvite] = useState({ name: "", email: "" });
  const [formUrl, setFormUrl] = useState<string | null>(null);
  const [signDoc, setSignDoc] = useState<Doc | null>(null);
  const [signForm, setSignForm] = useState<{ role: string; signerName: string; dataUrl: string | null }>({ role: "", signerName: "", dataUrl: null });

  const refreshDocs = () => qc.invalidateQueries({ queryKey: ["project-docs", projectId] });

  const sign = useMutation({
    mutationFn: () => apiPost(`/documents/${signDoc!.id}/signatures`, { role: signForm.role, signerName: signForm.signerName, dataUrl: signForm.dataUrl }),
    onSuccess: () => {
      toast.success("Assinatura registrada");
      setSignDoc(null);
      setSignForm({ role: "", signerName: "", dataUrl: null });
      refreshDocs();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao assinar")),
  });

  const doUpload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("projectId", projectId);
      fd.append("type", upload.type);
      fd.append("title", upload.title || file!.name);
      fd.append("visibleToClient", String(upload.visibleToClient));
      return apiPostForm("/documents", fd);
    },
    onSuccess: () => {
      toast.success("Documento enviado");
      setFile(null);
      setUpload({ type: "OUTRO", title: "", visibleToClient: true });
      if (fileRef.current) fileRef.current.value = "";
      refreshDocs();
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao enviar")),
  });

  const toggleVisible = useMutation({
    mutationFn: (d: Doc) => apiPatch(`/documents/${d.id}`, { visibleToClient: !d.visibleToClient }),
    onSuccess: refreshDocs,
    onError: (e) => toast.error(errorMessage(e, "Falha ao atualizar")),
  });
  const removeDoc = useMutation({
    mutationFn: (id: string) => apiDelete(`/documents/${id}`),
    onSuccess: () => { toast.success("Documento removido"); refreshDocs(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });

  const saveFormUrl = useMutation({
    mutationFn: () => apiPatch(`/business/projects/${projectId}`, { feedbackFormUrl: formUrl ?? "" }),
    onSuccess: () => { toast.success("Link salvo"); qc.invalidateQueries({ queryKey: ["project", projectId] }); setFormUrl(null); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });

  const sendInvite = useMutation({
    mutationFn: () => apiPost(`/business/clients/${clientId}/accounts`, invite),
    onSuccess: () => { toast.success("Convite enviado"); setInvite({ name: "", email: "" }); qc.invalidateQueries({ queryKey: ["client-accounts", clientId] }); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao convidar")),
  });
  const resendInvite = useMutation({
    mutationFn: (id: string) => apiPost(`/business/clients/${clientId}/accounts/${id}/resend`),
    onSuccess: () => toast.success("Convite reenviado"),
    onError: (e) => toast.error(errorMessage(e, "Falha ao reenviar")),
  });
  const setAccountStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      apiPatch(`/business/clients/${clientId}/accounts/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-accounts", clientId] }),
    onError: (e) => toast.error(errorMessage(e, "Falha ao atualizar")),
  });

  if (project.isLoading) return <PageSkeleton />;
  if (!project.data?.data) return <EmptyState title="Projeto não encontrado" />;
  const p = project.data.data;
  const currentFormUrl = formUrl ?? p.feedbackFormUrl ?? "";

  return (
    <div className="space-y-6">
      <Link to="/clientes-projetos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Clientes e projetos
      </Link>
      <PageHeader title={`${p.code} — ${p.name}`} description={`Cliente: ${p.client.name}`} />

      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">Documentos ({p._count.documents})</TabsTrigger>
          <TabsTrigger value="portal">Portal do cliente</TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="space-y-4">
          {canManage && (
            <Card>
              <CardHeader><CardTitle className="text-base">Enviar documento</CardTitle></CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Arquivo</Label>
                  <Input ref={fileRef} type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={upload.type} onValueChange={(v) => setUpload({ ...upload, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DOC_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Título</Label>
                  <Input value={upload.title} placeholder={file?.name ?? "Nome do documento"} onChange={(e) => setUpload({ ...upload, title: e.target.value })} />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex items-center gap-2">
                    <Switch checked={upload.visibleToClient} onCheckedChange={(v) => setUpload({ ...upload, visibleToClient: v })} id="vis" />
                    <Label htmlFor="vis">Visível ao cliente</Label>
                  </div>
                  <Button className="ml-auto" disabled={!file || doUpload.isPending} onClick={() => doUpload.mutate()}>
                    {doUpload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    Enviar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {docs.isLoading ? (
            <PageSkeleton />
          ) : (docs.data?.data.length ?? 0) === 0 ? (
            <EmptyState title="Nenhum documento" description="Envie o cronograma, a garantia e a vistoria deste projeto." />
          ) : (
            <div className="space-y-2">
              {docs.data!.data.map((d) => (
                <div key={d.id} className="space-y-2 rounded-lg border border-border bg-card px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {d.title}
                        {d.requiresSignature && (
                          <Badge className="ml-2 align-middle" variant={d.signatureStatus === "SIGNED" ? "success" : "warning"}>
                            {d.signatureStatus === "SIGNED" ? "Assinado" : "Assinatura pendente"}
                          </Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {DOC_LABEL[d.type] ?? d.type} · {fmtSize(d.sizeBytes)}{d.version > 1 ? ` · v${d.version}` : ""} · {fmtDate(d.createdAt)}
                        {d.uploadedBy ? ` · ${d.uploadedBy.name}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={d.visibleToClient}
                        disabled={!canManage || toggleVisible.isPending}
                        onCheckedChange={() => toggleVisible.mutate(d)}
                        title="Visível ao cliente"
                      />
                      {d.requiresSignature && canManage && d.signatureStatus !== "SIGNED" && (
                        <Button size="sm" variant="outline" onClick={() => setSignDoc(d)}>
                          <FileSignature className="mr-1 h-4 w-4" /> Assinar
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => apiDownload(`/documents/${d.id}/download`, d.fileName).catch((e) => toast.error(errorMessage(e, "Falha ao baixar")))}>
                        <Download className="h-4 w-4" />
                      </Button>
                      {canManage && (
                        <Button size="sm" variant="ghost" onClick={() => { if (confirm("Remover este documento?")) removeDoc.mutate(d.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {d.requiresSignature && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {(d.signerRoles.length ? d.signerRoles : ["MOBIEER", "CLIENTE"]).map((role) => {
                        const s = d.signatures.find((x) => x.role === role);
                        return (
                          <span key={role} className={s ? "text-success" : ""}>
                            {role}: {s ? `${s.signerName} · ${fmtDate(s.signedAt)}` : "pendente"}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="portal" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Formulário de avaliação</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Link do Google Forms exibido para o cliente neste projeto. Em branco usa o formulário padrão da empresa.</p>
              <div className="flex gap-2">
                <Input value={currentFormUrl} placeholder="https://docs.google.com/forms/..." onChange={(e) => setFormUrl(e.target.value)} />
                <Button disabled={formUrl === null || saveFormUrl.isPending} onClick={() => saveFormUrl.mutate()}>Salvar</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Contas de acesso — {p.client.name}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!canManageAccounts ? (
                <p className="text-sm text-muted-foreground">Sem permissão para gerenciar acessos.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-2">
                      <Label>Nome</Label>
                      <Input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>E-mail</Label>
                      <Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
                    </div>
                    <Button disabled={invite.name.length < 2 || !invite.email.includes("@") || sendInvite.isPending} onClick={() => sendInvite.mutate()}>
                      {sendInvite.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Convidar
                    </Button>
                  </div>

                  {accounts.isLoading ? (
                    <PageSkeleton />
                  ) : (accounts.data?.data.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma conta de acesso criada.</p>
                  ) : (
                    <div className="space-y-2">
                      {accounts.data!.data.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{a.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {a.email} · último acesso {fmtDate(a.lastLogin)}
                            </p>
                          </div>
                          <Badge variant="secondary">{ACCOUNT_LABEL[a.status]}</Badge>
                          {a.status !== "ACTIVE" && (
                            <Button size="sm" variant="outline" onClick={() => resendInvite.mutate(a.id)}>Reenviar convite</Button>
                          )}
                          {a.status === "ACTIVE" ? (
                            <Button size="sm" variant="ghost" onClick={() => setAccountStatus.mutate({ id: a.id, status: "DISABLED" })}>Desativar</Button>
                          ) : a.status === "DISABLED" ? (
                            <Button size="sm" variant="ghost" onClick={() => setAccountStatus.mutate({ id: a.id, status: "ACTIVE" })}>Reativar</Button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!signDoc} onOpenChange={(v) => !v && setSignDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assinar — {signDoc?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Assinando como</Label>
              <Select value={signForm.role || "NONE"} onValueChange={(v) => setSignForm({ ...signForm, role: v === "NONE" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione o papel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Selecione</SelectItem>
                  {(signDoc?.signerRoles.length ? signDoc.signerRoles : ["MOBIEER", "CLIENTE"])
                    .filter((r) => !signDoc?.signatures.some((s) => s.role === r))
                    .map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nome de quem assina</Label>
              <Input value={signForm.signerName} onChange={(e) => setSignForm({ ...signForm, signerName: e.target.value })} />
            </div>
            <SignaturePad onChange={(dataUrl) => setSignForm((f) => ({ ...f, dataUrl }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignDoc(null)}>Cancelar</Button>
            <Button disabled={sign.isPending || !signForm.role || signForm.signerName.trim().length < 2 || !signForm.dataUrl} onClick={() => sign.mutate()}>
              {sign.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar assinatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
