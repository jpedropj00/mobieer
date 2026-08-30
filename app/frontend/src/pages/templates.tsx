import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSignature, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiDelete, apiDownload, apiGet, apiPatch, apiPost, apiPostForm } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/utils";
import type { DocumentTemplate } from "@/types";

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
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
type Picklist = { id: string; name: string }[];

export function TemplatesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("documents.manage");

  const templates = useQuery({ queryKey: ["templates"], queryFn: () => apiGet<{ data: DocumentTemplate[] }>("/templates") });
  const clients = useQuery({ queryKey: ["business-clients", "picklist"], queryFn: () => apiGet<{ data: Picklist }>("/business/clients"), enabled: canManage });
  const projects = useQuery({ queryKey: ["business-projects", "picklist"], queryFn: () => apiGet<{ data: { id: string; name: string; client: { id: string } }[] }>("/business/projects"), enabled: canManage });

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [upl, setUpl] = useState({ name: "", type: "CONTRATO", description: "", requiresSignature: true, signerRoles: "MOBIEER, CLIENTE", visibleToClient: true });
  const [uploadOpen, setUploadOpen] = useState(false);

  const [genFor, setGenFor] = useState<DocumentTemplate | null>(null);
  const [gen, setGen] = useState({ clientId: "", projectId: "" });

  const refresh = () => qc.invalidateQueries({ queryKey: ["templates"] });

  const create = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("name", upl.name || file!.name);
      fd.append("type", upl.type);
      fd.append("description", upl.description);
      fd.append("requiresSignature", String(upl.requiresSignature));
      fd.append("visibleToClient", String(upl.visibleToClient));
      if (upl.requiresSignature) fd.append("signerRoles", upl.signerRoles);
      return apiPostForm("/templates", fd);
    },
    onSuccess: () => {
      toast.success("Modelo criado");
      setUploadOpen(false);
      setFile(null);
      setUpl({ name: "", type: "CONTRATO", description: "", requiresSignature: true, signerRoles: "MOBIEER, CLIENTE", visibleToClient: true });
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao criar modelo")),
  });

  const toggleActive = useMutation({
    mutationFn: (t: DocumentTemplate) => apiPatch(`/templates/${t.id}`, { active: !t.active }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e, "Falha")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/templates/${id}`),
    onSuccess: () => { toast.success("Modelo removido"); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });
  const generate = useMutation({
    mutationFn: () => apiPost(`/templates/${genFor!.id}/generate`, { clientId: gen.clientId, projectId: gen.projectId || null }),
    onSuccess: () => {
      toast.success("Documento gerado para o cliente");
      setGenFor(null);
      setGen({ clientId: "", projectId: "" });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao gerar")),
  });

  if (templates.isLoading) return <PageSkeleton />;
  const list = templates.data?.data ?? [];
  const projForClient = (projects.data?.data ?? []).filter((p) => !gen.clientId || p.client.id === gen.clientId);

  return (
    <div className="space-y-6">
      <PageHeader title="Modelos de documentos" description="Contratos e arquivos padrão. Gere um por cliente e colha assinaturas no app.">
        {canManage && (
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Novo modelo
          </Button>
        )}
      </PageHeader>

      {list.length === 0 ? (
        <EmptyState title="Nenhum modelo" description="Envie um PDF de contrato, garantia ou checklist como modelo." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((t) => (
            <Card key={t.id} className={t.active ? "" : "opacity-60"}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-start justify-between gap-2 text-base">
                  <span className="flex-1">{t.name}</span>
                  <Badge variant="secondary">{DOC_LABEL[t.type] ?? t.type}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  {t.fileName} · {fmtSize(t.sizeBytes)} · {t.generatedCount} gerado(s)
                </p>
                {t.requiresSignature ? (
                  <p className="inline-flex items-center gap-1.5 text-xs">
                    <FileSignature className="h-3.5 w-3.5 text-primary" />
                    Assinatura: {t.signerRoles.join(" + ")}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Sem assinatura</p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => apiDownload(`/templates/${t.id}/download`, t.fileName).catch((e) => toast.error(errorMessage(e, "Falha")))}>
                    <Download className="h-4 w-4" />
                  </Button>
                  {canManage && (
                    <>
                      <Button size="sm" onClick={() => { setGenFor(t); setGen({ clientId: "", projectId: "" }); }}>
                        Gerar para cliente
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate(t)}>
                        {t.active ? "Desativar" : "Ativar"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("Remover este modelo?")) remove.mutate(t.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Novo modelo */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo modelo de documento</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Arquivo (PDF)</Label>
              <Input ref={fileRef} type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={upl.name} placeholder={file?.name ?? "Ex.: Contrato de prestação de serviços"} onChange={(e) => setUpl({ ...upl, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={upl.type} onValueChange={(v) => setUpl({ ...upl, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Descrição</Label>
              <Textarea rows={2} value={upl.description} onChange={(e) => setUpl({ ...upl, description: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="rs" checked={upl.requiresSignature} onCheckedChange={(v) => setUpl({ ...upl, requiresSignature: v })} />
              <Label htmlFor="rs">Exige assinatura</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="vc" checked={upl.visibleToClient} onCheckedChange={(v) => setUpl({ ...upl, visibleToClient: v })} />
              <Label htmlFor="vc">Visível ao cliente</Label>
            </div>
            {upl.requiresSignature && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Papéis que assinam (separados por vírgula)</Label>
                <Input value={upl.signerRoles} onChange={(e) => setUpl({ ...upl, signerRoles: e.target.value })} placeholder="MOBIEER, CLIENTE" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancelar</Button>
            <Button disabled={!file || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Criar modelo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Gerar para cliente */}
      <Dialog open={!!genFor} onOpenChange={(v) => !v && setGenFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar "{genFor?.name}" para um cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Select value={gen.clientId || "NONE"} onValueChange={(v) => setGen({ clientId: v === "NONE" ? "" : v, projectId: "" })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Selecione</SelectItem>
                  {clients.data?.data.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Projeto (opcional)</Label>
              <Select value={gen.projectId || "NONE"} onValueChange={(v) => setGen({ ...gen, projectId: v === "NONE" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Nenhum (nível cliente)</SelectItem>
                  {projForClient.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {genFor?.requiresSignature && (
              <p className="text-xs text-muted-foreground">
                O documento gerado ficará pendente de assinatura ({genFor.signerRoles.join(" + ")}).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenFor(null)}>Cancelar</Button>
            <Button disabled={!gen.clientId || generate.isPending} onClick={() => generate.mutate()}>
              {generate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Gerar documento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
