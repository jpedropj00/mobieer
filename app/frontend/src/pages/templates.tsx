import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSignature, FileText, Loader2, Pencil, Plus, Trash2, Upload, Wand2 } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiDelete, apiDownload, apiGet, apiPatch, apiPost, apiPostForm } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/utils";
import type { ContractPreview, DocumentTemplate, MergeField } from "@/types";

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
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Picklist = { id: string; name: string }[];
type ProjectRow = { id: string; name: string; client: { id: string } };
type PromobImport = { id: string; fileName: string; totalValue: number | null; itemCount: number; createdAt: string };

export function TemplatesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("documents.manage");

  const templates = useQuery({ queryKey: ["templates"], queryFn: () => apiGet<{ data: DocumentTemplate[] }>("/templates") });
  const clients = useQuery({ queryKey: ["business-clients", "picklist"], queryFn: () => apiGet<{ data: Picklist }>("/business/clients"), enabled: canManage });
  const projects = useQuery({ queryKey: ["business-projects", "picklist"], queryFn: () => apiGet<{ data: ProjectRow[] }>("/business/projects"), enabled: canManage });
  const merge = useQuery({
    queryKey: ["templates", "merge-fields"],
    queryFn: () => apiGet<{ data: { fields: MergeField[]; defaultBody: string } }>("/templates/merge-fields"),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [upl, setUpl] = useState({ name: "", type: "CONTRATO", description: "", requiresSignature: true, signerRoles: "MOBIEER, CLIENTE", visibleToClient: true });
  const [body, setBody] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

  const [genFor, setGenFor] = useState<DocumentTemplate | null>(null);
  const [gen, setGen] = useState({ clientId: "", projectId: "" });

  const [editBody, setEditBody] = useState<DocumentTemplate | null>(null);
  const [editText, setEditText] = useState("");

  const refresh = () => qc.invalidateQueries({ queryKey: ["templates"] });

  const create = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      if (file) fd.append("file", file);
      fd.append("name", upl.name || file?.name || "Modelo");
      fd.append("type", upl.type);
      fd.append("description", upl.description);
      if (body.trim()) fd.append("body", body);
      fd.append("requiresSignature", String(upl.requiresSignature));
      fd.append("visibleToClient", String(upl.visibleToClient));
      if (upl.requiresSignature) fd.append("signerRoles", upl.signerRoles);
      return apiPostForm("/templates", fd);
    },
    onSuccess: () => {
      toast.success("Modelo criado");
      setUploadOpen(false);
      setFile(null);
      setBody("");
      setUpl({ name: "", type: "CONTRATO", description: "", requiresSignature: true, signerRoles: "MOBIEER, CLIENTE", visibleToClient: true });
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao criar modelo")),
  });

  const saveBody = useMutation({
    mutationFn: () => apiPatch(`/templates/${editBody!.id}`, { body: editText }),
    onSuccess: () => {
      toast.success("Modelo atualizado");
      setEditBody(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
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

  const [contractFor, setContractFor] = useState<DocumentTemplate | null>(null);

  if (templates.isLoading) return <PageSkeleton />;
  const list = templates.data?.data ?? [];
  const projForClient = (projects.data?.data ?? []).filter((p) => !gen.clientId || p.client.id === gen.clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Modelos de documentos"
        description="Contratos e arquivos padrão. O modelo de contrato usa marcadores {{...}} e puxa os valores do Promob."
      >
        {canManage && (
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Novo modelo
          </Button>
        )}
      </PageHeader>

      {list.length === 0 ? (
        <EmptyState title="Nenhum modelo" description="Escreva um contrato com marcadores ou envie um PDF padrão." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((t) => (
            <Card key={t.id} className={t.active ? "" : "opacity-60"}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-start justify-between gap-2 text-base">
                  <span className="flex-1">{t.name}</span>
                  <div className="flex shrink-0 gap-1">
                    {t.hasBody && <Badge variant="success">Automático</Badge>}
                    <Badge variant="secondary">{DOC_LABEL[t.type] ?? t.type}</Badge>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  {t.hasFile ? `${t.fileName} · ${fmtSize(t.sizeBytes ?? 0)}` : "Modelo de texto (gera PDF na hora)"} · {t.generatedCount} gerado(s)
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
                  {t.hasFile && t.fileName && (
                    <Button size="sm" variant="outline" title="Baixar arquivo do modelo" onClick={() => apiDownload(`/templates/${t.id}/download`, t.fileName!).catch((e) => toast.error(errorMessage(e, "Falha")))}>
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                  {canManage && (
                    <>
                      {t.hasBody ? (
                        <Button size="sm" onClick={() => setContractFor(t)}>
                          <Wand2 className="mr-2 h-4 w-4" /> Gerar contrato
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => { setGenFor(t); setGen({ clientId: "", projectId: "" }); }}>
                          Gerar para cliente
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        title="Editar o texto do modelo"
                        onClick={() => { setEditBody(t); setEditText(t.body ?? merge.data?.data.defaultBody ?? ""); }}
                      >
                        <Pencil className="h-4 w-4" />
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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Novo modelo de documento</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={upl.name} placeholder={file?.name ?? "Ex.: Contrato de móveis planejados"} onChange={(e) => setUpl({ ...upl, name: e.target.value })} />
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

            <div className="sm:col-span-2">
              <Tabs defaultValue="texto">
                <TabsList>
                  <TabsTrigger value="texto">Contrato automático (texto)</TabsTrigger>
                  <TabsTrigger value="arquivo">Arquivo pronto (PDF)</TabsTrigger>
                </TabsList>
                <TabsContent value="texto" className="space-y-2 pt-3">
                  <div className="flex items-center justify-between">
                    <Label>Corpo do contrato</Label>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setBody(merge.data?.data.defaultBody ?? "")}>
                      Usar modelo pronto
                    </Button>
                  </div>
                  <Textarea
                    rows={12}
                    className="font-mono text-xs"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Escreva o contrato usando marcadores como {{cliente.nome}} e {{promob.total}}…"
                  />
                  <MergeFieldHelp fields={merge.data?.data.fields ?? []} onInsert={(k) => setBody((b) => `${b}{{${k}}}`)} />
                </TabsContent>
                <TabsContent value="arquivo" className="space-y-2 pt-3">
                  <Label>Arquivo (PDF)</Label>
                  <Input ref={fileRef} type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <p className="text-xs text-muted-foreground">
                    O arquivo é copiado como está para o cliente — sem substituição de dados.
                  </p>
                </TabsContent>
              </Tabs>
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
            <Button disabled={(!file && !body.trim()) || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Criar modelo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar corpo do modelo */}
      <Dialog open={!!editBody} onOpenChange={(v) => !v && setEditBody(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Editar texto de "{editBody?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Corpo do contrato</Label>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditText(merge.data?.data.defaultBody ?? "")}>
                Usar modelo pronto
              </Button>
            </div>
            <Textarea rows={16} className="font-mono text-xs" value={editText} onChange={(e) => setEditText(e.target.value)} />
            <MergeFieldHelp fields={merge.data?.data.fields ?? []} onInsert={(k) => setEditText((b) => `${b}{{${k}}}`)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBody(null)}>Cancelar</Button>
            <Button disabled={saveBody.isPending} onClick={() => saveBody.mutate()}>
              {saveBody.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Gerar cópia do arquivo para cliente */}
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

      {contractFor && (
        <ContractDialog
          template={contractFor}
          clients={clients.data?.data ?? []}
          projects={projects.data?.data ?? []}
          onClose={() => setContractFor(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

/** Lista de marcadores disponíveis; clicar insere no fim do texto. */
function MergeFieldHelp({ fields, onInsert }: { fields: MergeField[]; onInsert: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!fields.length) return null;
  return (
    <div className="rounded-lg border border-border p-2">
      <button type="button" className="flex w-full items-center justify-between text-xs font-medium" onClick={() => setOpen((v) => !v)}>
        <span>Marcadores disponíveis ({fields.length})</span>
        <span className="text-muted-foreground">{open ? "ocultar" : "mostrar"}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1">
          {fields.map((f) => (
            <button
              key={f.key}
              type="button"
              title={`${f.label} — ex.: ${f.example}`}
              onClick={() => onInsert(f.key)}
              className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent"
            >
              {`{{${f.key}}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Geração do contrato: escolhe cliente/projeto, puxa o orçamento do Promob,
 * mostra o texto já substituído e só então gera o PDF.
 */
function ContractDialog({
  template,
  clients,
  projects,
  onClose,
  onDone,
}: {
  template: DocumentTemplate;
  clients: Picklist;
  projects: ProjectRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    clientId: "",
    projectId: "",
    promobImportId: "",
    entrada: "",
    parcelas: "",
    valorParcela: "",
    condicaoPagamento: "",
    prazoEntregaDias: "45",
    totalOverride: "",
  });
  const [preview, setPreview] = useState<ContractPreview | null>(null);

  const projForClient = projects.filter((p) => !form.clientId || p.client.id === form.clientId);

  const imports = useQuery({
    queryKey: ["promob-imports", form.projectId],
    queryFn: () => apiGet<{ data: PromobImport[] }>(`/promob/projects/${form.projectId}/imports`),
    enabled: !!form.projectId,
  });

  // Pré-seleciona a importação mais recente que tenha valor.
  useEffect(() => {
    const list = imports.data?.data ?? [];
    if (!list.length || form.promobImportId) return;
    const withValue = list.find((i) => i.totalValue != null);
    if (withValue) setForm((f) => ({ ...f, promobImportId: withValue.id }));
  }, [imports.data, form.promobImportId]);

  const payload = useMemo(() => {
    const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
    return {
      clientId: form.clientId,
      projectId: form.projectId || null,
      promobImportId: form.promobImportId || null,
      entrada: n(form.entrada),
      parcelas: n(form.parcelas),
      valorParcela: n(form.valorParcela),
      condicaoPagamento: form.condicaoPagamento || null,
      prazoEntregaDias: n(form.prazoEntregaDias),
      totalOverride: n(form.totalOverride),
      title: `${template.name} — ${clients.find((c) => c.id === form.clientId)?.name ?? ""}`.trim(),
    };
  }, [form, template.name, clients]);

  const doPreview = useMutation({
    mutationFn: () => apiPost<{ data: ContractPreview }>(`/templates/${template.id}/contract/preview`, payload),
    onSuccess: (r) => setPreview(r.data),
    onError: (e) => toast.error(errorMessage(e, "Falha ao montar a prévia")),
  });

  const doGenerate = useMutation({
    mutationFn: () => apiPost<{ data: { id: string; fileName: string; missing: string[] } }>(`/templates/${template.id}/contract`, payload),
    onSuccess: (r) => {
      toast.success(r.data.missing.length ? `Contrato gerado — ${r.data.missing.length} campo(s) em branco` : "Contrato gerado");
      onDone();
      onClose();
      apiDownload(`/documents/${r.data.id}/download`, r.data.fileName).catch(() => undefined);
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao gerar o contrato")),
  });

  const selectedImport = (imports.data?.data ?? []).find((i) => i.id === form.promobImportId);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Gerar contrato — {template.name}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Cliente</Label>
            <Select
              value={form.clientId || "NONE"}
              onValueChange={(v) => { setForm({ ...form, clientId: v === "NONE" ? "" : v, projectId: "", promobImportId: "" }); setPreview(null); }}
            >
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Selecione</SelectItem>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Projeto</Label>
            <Select
              value={form.projectId || "NONE"}
              onValueChange={(v) => { setForm({ ...form, projectId: v === "NONE" ? "" : v, promobImportId: "" }); setPreview(null); }}
            >
              <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Nenhum</SelectItem>
                {projForClient.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>Orçamento do Promob</Label>
            <Select value={form.promobImportId || "NONE"} onValueChange={(v) => { setForm({ ...form, promobImportId: v === "NONE" ? "" : v }); setPreview(null); }}>
              <SelectTrigger>
                <SelectValue placeholder={form.projectId ? "Mais recente com valor" : "Selecione um projeto primeiro"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Mais recente com valor</SelectItem>
                {(imports.data?.data ?? []).map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.fileName} — {i.totalValue != null ? brl(i.totalValue) : "sem valor no XML"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedImport && (
              <p className="text-xs text-muted-foreground">
                {selectedImport.itemCount} item(ns) ·{" "}
                {selectedImport.totalValue != null ? (
                  <span className="text-foreground">{brl(selectedImport.totalValue)}</span>
                ) : (
                  <span className="text-warning">o XML não trouxe valores — informe o total manualmente abaixo</span>
                )}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Total (deixe vazio para usar o do Promob)</Label>
            <Input inputMode="decimal" placeholder="45000" value={form.totalOverride} onChange={(e) => { setForm({ ...form, totalOverride: e.target.value }); setPreview(null); }} />
          </div>
          <div className="space-y-2">
            <Label>Prazo de entrega (dias)</Label>
            <Input inputMode="numeric" value={form.prazoEntregaDias} onChange={(e) => { setForm({ ...form, prazoEntregaDias: e.target.value }); setPreview(null); }} />
          </div>
          <div className="space-y-2">
            <Label>Entrada</Label>
            <Input inputMode="decimal" placeholder="15000" value={form.entrada} onChange={(e) => { setForm({ ...form, entrada: e.target.value }); setPreview(null); }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Parcelas</Label>
              <Input inputMode="numeric" placeholder="10" value={form.parcelas} onChange={(e) => { setForm({ ...form, parcelas: e.target.value }); setPreview(null); }} />
            </div>
            <div className="space-y-2">
              <Label>Valor da parcela</Label>
              <Input inputMode="decimal" placeholder="3000" value={form.valorParcela} onChange={(e) => { setForm({ ...form, valorParcela: e.target.value }); setPreview(null); }} />
            </div>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Condição de pagamento (texto livre)</Label>
            <Input placeholder="Entrada no PIX + 10x no boleto" value={form.condicaoPagamento} onChange={(e) => { setForm({ ...form, condicaoPagamento: e.target.value }); setPreview(null); }} />
          </div>
        </div>

        {preview && (
          <div className="space-y-2">
            {preview.missing.length > 0 && (
              <p className="rounded-md bg-warning/10 p-2 text-xs text-warning-foreground">
                Campos sem valor (saem em branco no PDF): {preview.missing.join(", ")}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Total do contrato:{" "}
              <span className="font-medium text-foreground">{preview.meta.total != null ? brl(preview.meta.total) : "—"}</span>{" "}
              ({preview.meta.totalSource === "PROMOB" ? "do Promob" : preview.meta.totalSource === "MANUAL" ? "informado manualmente" : "não definido"})
            </p>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3">
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{preview.text}</pre>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="outline" disabled={!form.clientId || doPreview.isPending} onClick={() => doPreview.mutate()}>
            {doPreview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            Ver prévia
          </Button>
          <Button disabled={!form.clientId || doGenerate.isPending} onClick={() => doGenerate.mutate()}>
            {doGenerate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            Gerar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
