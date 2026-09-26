/**
 * Documentos do montador (§7): a empresa anexa, envia e acompanha em que passo
 * cada documento está. Quem visualiza, assina ou recusa é o montador, pela
 * própria área — aqui é só o lado de quem gerencia.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, FileSignature, Loader2, Send, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/states";
import { SignaturePad } from "@/components/signature-pad";
import { apiDelete, apiGet, apiPost, apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/utils";
import type { Contractor, ContractorDocument, ContractorDocumentStatus, ContractorDocumentType } from "@/types";

const TIPOS: { value: ContractorDocumentType; label: string }[] = [
  { value: "CONTRATO", label: "Contrato" },
  { value: "TERMO_RESPONSABILIDADE", label: "Termo de responsabilidade (ferramentas)" },
  { value: "REGULAMENTO_INTERNO", label: "Regulamento interno" },
  { value: "REGRAS_EMPRESA", label: "Regras da empresa" },
  { value: "DOCUMENTO_PESSOAL", label: "Documento pessoal" },
  { value: "CERTIFICADO", label: "Certificado" },
  { value: "COMPROVANTE", label: "Comprovante" },
  { value: "OUTRO", label: "Outro" },
];

/** Cor do status: o que exige ação da empresa ou travou fica em destaque. */
const TOM: Record<ContractorDocumentStatus, "muted" | "warning" | "success" | "danger"> = {
  AGUARDANDO_ENVIO: "muted",
  ENVIADO: "warning",
  VISUALIZADO: "warning",
  AGUARDANDO_ASSINATURA: "warning",
  ASSINADO: "success",
  RECUSADO: "danger",
};

const fmt = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;

export function ContractorDocumentsTab({ contractors, canManage }: { contractors: Contractor[]; canManage: boolean }) {
  const qc = useQueryClient();
  const [contractorId, setContractorId] = useState<string>(contractors[0]?.id ?? "");
  const [novo, setNovo] = useState(false);
  const [assinatura, setAssinatura] = useState<{ doc: ContractorDocument; dataUrl: string; signerName: string; signedAt: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<{ kind: ContractorDocumentType; title: string; requiresSignature: boolean; file: File | null }>({
    kind: "CONTRATO",
    title: "",
    requiresSignature: true,
    file: null,
  });

  const docs = useQuery({
    queryKey: ["contractor-documents", contractorId],
    queryFn: () => apiGet<{ data: ContractorDocument[] }>(`/contractors/${contractorId}/documents`).then((r) => r.data),
    enabled: Boolean(contractorId),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["contractor-documents", contractorId] });

  const enviarArquivo = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", form.file!);
      fd.append("kind", form.kind);
      fd.append("title", form.title);
      fd.append("requiresSignature", String(form.requiresSignature));
      return apiPostForm<{ data: ContractorDocument; message?: string }>(`/contractors/${contractorId}/documents`, fd);
    },
    onSuccess: (r) => {
      toast.success(r.message ?? "Documento anexado");
      setNovo(false);
      setForm({ kind: "CONTRATO", title: "", requiresSignature: true, file: null });
      invalidar();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível anexar")),
  });

  const enviar = useMutation({
    mutationFn: (id: string) => apiPost<{ data: ContractorDocument; message?: string }>(`/contractors/documents/${id}/send`, {}),
    onSuccess: (r) => {
      toast.success(r.message ?? "Documento enviado");
      invalidar();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível enviar")),
  });

  const excluir = useMutation({
    mutationFn: (id: string) => apiDelete(`/contractors/documents/${id}`),
    onSuccess: () => {
      toast.success("Documento excluído");
      invalidar();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível excluir")),
  });

  const verAssinatura = useMutation({
    mutationFn: (doc: ContractorDocument) =>
      apiGet<{ data: { signatureDataUrl: string; signerName: string; signedAt: string } }>(`/contractors/documents/${doc.id}/signature`).then((r) => ({
        doc,
        dataUrl: r.data.signatureDataUrl,
        signerName: r.data.signerName,
        signedAt: r.data.signedAt,
      })),
    onSuccess: (r) => setAssinatura(r),
    onError: (e) => toast.error(errorMessage(e, "Não foi possível carregar a assinatura")),
  });

  const lista = docs.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Label className="text-xs text-muted-foreground">Montador</Label>
          <Select value={contractorId} onValueChange={setContractorId}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {contractors.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManage && contractorId && (
          <Button onClick={() => setNovo(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Anexar documento
          </Button>
        )}
      </div>

      {!contractorId ? (
        <EmptyState title="Nenhum montador" description="Cadastre um montador para enviar documentos." />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum documento"
          description="Anexe contrato, termo de ferramentas ou regulamento. O montador só vê depois que você enviar."
        />
      ) : (
        <div className="space-y-3">
          {lista.map((d) => (
            <Card key={d.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-sm">{d.title}</CardTitle>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {TIPOS.find((t) => t.value === d.kind)?.label ?? d.kind} · {d.fileName}
                  </p>
                </div>
                <Badge variant={TOM[d.status]}>{d.statusLabel}</Badge>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {d.requiresSignature && <span className="font-medium text-foreground">Exige assinatura</span>}
                  {fmt(d.sentAt) && <span>Enviado {fmt(d.sentAt)}</span>}
                  {fmt(d.viewedAt) && <span>Visto {fmt(d.viewedAt)}</span>}
                  {fmt(d.signedAt) && (
                    <span className="text-success">
                      Assinado {fmt(d.signedAt)}
                      {d.signerName ? ` por ${d.signerName}` : ""}
                    </span>
                  )}
                </div>

                {d.status === "RECUSADO" && d.refusalReason && (
                  <p className="rounded-md bg-destructive/10 p-2 text-xs">
                    <strong>Recusado{fmt(d.refusedAt) ? ` em ${fmt(d.refusedAt)}` : ""}:</strong> {d.refusalReason}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/contractors/documents/${d.id}/file`} target="_blank" rel="noreferrer">
                      <Download className="mr-2 h-3.5 w-3.5" />
                      Abrir
                    </a>
                  </Button>

                  {canManage && (d.status === "AGUARDANDO_ENVIO" || d.status === "RECUSADO") && (
                    <Button size="sm" disabled={enviar.isPending} onClick={() => enviar.mutate(d.id)}>
                      {enviar.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}
                      {d.status === "RECUSADO" ? "Reenviar" : "Enviar ao montador"}
                    </Button>
                  )}

                  {d.status === "ASSINADO" && (
                    <Button variant="outline" size="sm" disabled={verAssinatura.isPending} onClick={() => verAssinatura.mutate(d)}>
                      <FileSignature className="mr-2 h-3.5 w-3.5" />
                      Ver assinatura
                    </Button>
                  )}

                  {canManage && d.status === "AGUARDANDO_ENVIO" && (
                    <Button variant="ghost" size="sm" disabled={excluir.isPending} onClick={() => excluir.mutate(d.id)}>
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Excluir
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* anexar */}
      <Dialog open={novo} onOpenChange={setNovo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anexar documento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as ContractorDocumentType })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Contrato de prestação de serviço" />
            </div>
            <div className="space-y-2">
              <Label>Arquivo</Label>
              <Input ref={fileRef} type="file" accept=".pdf,image/*,.doc,.docx" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">Exige assinatura</p>
                <p className="text-xs text-muted-foreground">O montador precisa assinar ou recusar com motivo.</p>
              </div>
              <Switch checked={form.requiresSignature} onCheckedChange={(v) => setForm({ ...form, requiresSignature: v })} />
            </div>
            <p className="text-xs text-muted-foreground">
              O documento fica como rascunho — o montador só passa a ver depois que você clicar em <strong>Enviar ao montador</strong>.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovo(false)}>
              Cancelar
            </Button>
            <Button
              disabled={enviarArquivo.isPending || !form.file || form.title.trim().length < 2}
              onClick={() => enviarArquivo.mutate()}
            >
              {enviarArquivo.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Anexar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* assinatura */}
      <Dialog open={Boolean(assinatura)} onOpenChange={() => setAssinatura(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assinatura</DialogTitle>
          </DialogHeader>
          {assinatura && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {assinatura.doc.title} · assinado por <strong className="text-foreground">{assinatura.signerName}</strong> em{" "}
                {fmt(assinatura.signedAt)}
              </p>
              <div className="rounded-md border border-border bg-white p-3">
                <img src={assinatura.dataUrl} alt={`Assinatura de ${assinatura.signerName}`} className="mx-auto max-h-48" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssinatura(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Lado do montador: lista os documentos que a empresa enviou e permite
 * assinar (desenhando) ou recusar com motivo.
 */
export function MyContractorDocuments() {
  const qc = useQueryClient();
  const [assinando, setAssinando] = useState<ContractorDocument | null>(null);
  const [recusando, setRecusando] = useState<ContractorDocument | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [motivo, setMotivo] = useState("");

  const docs = useQuery({
    queryKey: ["me-contractor-documents"],
    queryFn: () => apiGet<{ data: ContractorDocument[] }>("/me/contractor/documents").then((r) => r.data),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["me-contractor-documents"] });

  const assinar = useMutation({
    mutationFn: () => apiPost(`/me/contractor/documents/${assinando!.id}/sign`, { signerName, dataUrl }),
    onSuccess: () => {
      toast.success("Documento assinado");
      setAssinando(null);
      setDataUrl(null);
      setSignerName("");
      invalidar();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível assinar")),
  });

  const recusar = useMutation({
    mutationFn: () => apiPost(`/me/contractor/documents/${recusando!.id}/refuse`, { reason: motivo }),
    onSuccess: () => {
      toast.success("Recusa registrada");
      setRecusando(null);
      setMotivo("");
      invalidar();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível recusar")),
  });

  const lista = docs.data ?? [];
  if (lista.length === 0) {
    return <EmptyState title="Nenhum documento" description="Quando a empresa enviar um documento, ele aparece aqui." />;
  }

  return (
    <div className="space-y-3">
      {lista.map((d) => (
        <Card key={d.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-sm">{d.title}</CardTitle>
              <p className="mt-1 truncate text-xs text-muted-foreground">{d.fileName}</p>
            </div>
            <Badge variant={TOM[d.status]}>{d.statusLabel}</Badge>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {d.status === "RECUSADO" && d.refusalReason && (
              <p className="rounded-md bg-destructive/10 p-2 text-xs">Você recusou: {d.refusalReason}</p>
            )}
            {d.status === "ASSINADO" && fmt(d.signedAt) && <p className="text-xs text-success">Assinado em {fmt(d.signedAt)}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/me/contractor/documents/${d.id}/file`} target="_blank" rel="noreferrer">
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Abrir
                </a>
              </Button>
              {d.requiresSignature && d.status !== "ASSINADO" && (
                <>
                  <Button size="sm" onClick={() => setAssinando(d)}>
                    <Check className="mr-2 h-3.5 w-3.5" />
                    Assinar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRecusando(d)}>
                    <X className="mr-2 h-3.5 w-3.5" />
                    Recusar
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={Boolean(assinando)} onOpenChange={() => setAssinando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assinar documento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{assinando?.title}</p>
            <div className="space-y-2">
              <Label>Seu nome completo</Label>
              <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Assinatura</Label>
              <SignaturePad onChange={setDataUrl} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssinando(null)}>
              Cancelar
            </Button>
            <Button disabled={assinar.isPending || !dataUrl || signerName.trim().length < 3} onClick={() => assinar.mutate()}>
              {assinar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Assinar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(recusando)} onOpenChange={() => setRecusando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recusar documento</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Motivo</Label>
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Explique o que precisa ser corrigido" />
            <p className="text-xs text-muted-foreground">A empresa vê o motivo e pode corrigir e reenviar.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecusando(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={recusar.isPending || motivo.trim().length < 5} onClick={() => recusar.mutate()}>
              {recusar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Recusar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
