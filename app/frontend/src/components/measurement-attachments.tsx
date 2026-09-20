import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/states";
import { SketchPad } from "@/components/sketch-pad";
import { apiDelete, apiDownload, apiGet, apiObjectUrl, apiPost, apiPostForm, apiPut } from "@/services/api";
import type { MeasurementAttachment } from "@/types";
import { errorMessage } from "@/lib/utils";
import { AppError } from "@/lib/errors";

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtDate = (v: string) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Miniatura de um anexo de imagem (usa o endpoint autenticado). */
function Thumb({ att }: { att: MeasurementAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!att.mimeType.startsWith("image/")) return;
    let revoked: string | null = null;
    let alive = true;
    apiObjectUrl(`/measurements/attachments/${att.id}/download`)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        revoked = u;
        setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [att.id, att.mimeType, att.updatedAt]);

  if (!att.mimeType.startsWith("image/")) {
    return (
      <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
        <FileText className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="h-20 w-28 shrink-0 overflow-hidden rounded-md border border-border bg-white">
      {url ? <img src={url} alt={att.title} className="h-full w-full object-contain" /> : null}
    </div>
  );
}

/**
 * Anexos e desenho à mão de uma medição.
 * - Aba "Anexos": fotos e documentos do ambiente medido.
 * - Aba "Desenho": prancheta para o técnico desenhar a medida no tablet.
 */
export function MeasurementAttachments({ visitId, canManage }: { visitId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["measurement-attachments", visitId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => apiGet<{ data: MeasurementAttachment[] }>(`/measurements/${visitId}/attachments`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const files = (list.data?.data ?? []).filter((a) => a.kind === "FILE");
  const drawings = (list.data?.data ?? []).filter((a) => a.kind === "DRAWING");

  // ---- upload de arquivo ----
  const fileRef = useRef<HTMLInputElement>(null);
  const [upForm, setUpForm] = useState<{ title: string; notes: string; file: File | null }>({ title: "", notes: "", file: null });
  const [upOpen, setUpOpen] = useState(false);

  const upload = useMutation({
    mutationFn: () => {
      if (!upForm.file) throw new AppError("Escolha um arquivo");
      const fd = new FormData();
      fd.append("file", upForm.file);
      if (upForm.title.trim()) fd.append("title", upForm.title.trim());
      if (upForm.notes.trim()) fd.append("notes", upForm.notes.trim());
      return apiPostForm(`/measurements/${visitId}/attachments`, fd);
    },
    onSuccess: () => {
      toast.success("Anexo enviado");
      setUpOpen(false);
      setUpForm({ title: "", notes: "", file: null });
      if (fileRef.current) fileRef.current.value = "";
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao enviar anexo")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/measurements/attachments/${id}`),
    onSuccess: () => {
      toast.success("Anexo removido");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });

  // ---- prancheta de desenho ----
  const [sketchOpen, setSketchOpen] = useState(false);
  const [editing, setEditing] = useState<MeasurementAttachment | null>(null);
  const [sketchTitle, setSketchTitle] = useState("");
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const getPng = useRef<(() => string | null) | null>(null);
  const registerGetter = useCallback((fn: () => string | null) => {
    getPng.current = fn;
  }, []);

  const openNewSketch = () => {
    setEditing(null);
    setSketchTitle("");
    setBaseUrl(null);
    setSketchOpen(true);
  };

  const openEditSketch = async (att: MeasurementAttachment) => {
    setEditing(att);
    setSketchTitle(att.title);
    setBaseUrl(null);
    setSketchOpen(true);
    try {
      setBaseUrl(await apiObjectUrl(`/measurements/attachments/${att.id}/download`));
    } catch {
      toast.error("Não foi possível carregar o desenho para edição");
    }
  };

  // Libera o object URL do desenho carregado ao fechar.
  useEffect(() => {
    if (sketchOpen || !baseUrl) return;
    URL.revokeObjectURL(baseUrl);
    setBaseUrl(null);
  }, [sketchOpen, baseUrl]);

  const saveSketch = useMutation({
    mutationFn: () => {
      const dataUrl = getPng.current?.();
      if (!dataUrl) throw new AppError("Nada desenhado");
      const body = { dataUrl, title: sketchTitle.trim() || undefined };
      return editing
        ? apiPut(`/measurements/drawings/${editing.id}`, body)
        : apiPost(`/measurements/${visitId}/drawings`, body);
    },
    onSuccess: () => {
      toast.success(editing ? "Desenho atualizado" : "Desenho salvo");
      setSketchOpen(false);
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar o desenho")),
  });

  const row = (att: MeasurementAttachment, onEdit?: () => void) => (
    <div key={att.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
      <Thumb att={att} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{att.title}</p>
        <p className="text-xs text-muted-foreground">
          {fmtSize(att.sizeBytes)} · {fmtDate(att.updatedAt)}
          {att.createdBy ? ` · ${att.createdBy.name}` : ""}
        </p>
        {att.notes && <p className="mt-1 text-xs text-muted-foreground">{att.notes}</p>}
      </div>
      <div className="flex shrink-0 gap-1">
        {onEdit && canManage && (
          <Button size="sm" variant="ghost" onClick={onEdit} title="Continuar desenho">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          title="Baixar"
          onClick={() => apiDownload(`/measurements/attachments/${att.id}/download`, att.fileName).catch(() => toast.error("Falha ao baixar"))}
        >
          <Download className="h-4 w-4" />
        </Button>
        {canManage && (
          <Button size="sm" variant="ghost" className="text-destructive" title="Remover" onClick={() => remove.mutate(att.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <Tabs defaultValue="anexos">
        <TabsList>
          <TabsTrigger value="anexos">Anexos {files.length ? `(${files.length})` : ""}</TabsTrigger>
          <TabsTrigger value="desenho">Desenho {drawings.length ? `(${drawings.length})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="anexos" className="space-y-3 pt-3">
          {canManage && (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setUpOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Anexar arquivo
              </Button>
            </div>
          )}
          {list.isLoading ? (
            <p className="py-4 text-center text-xs text-muted-foreground">Carregando…</p>
          ) : files.length === 0 ? (
            <EmptyState title="Nenhum anexo" description="Fotos do ambiente, plantas e documentos da medição ficam aqui." />
          ) : (
            <div className="space-y-2">{files.map((a) => row(a))}</div>
          )}
        </TabsContent>

        <TabsContent value="desenho" className="space-y-3 pt-3">
          {canManage && (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={openNewSketch}>
                <Pencil className="mr-2 h-4 w-4" /> Novo desenho
              </Button>
            </div>
          )}
          {list.isLoading ? (
            <p className="py-4 text-center text-xs text-muted-foreground">Carregando…</p>
          ) : drawings.length === 0 ? (
            <EmptyState
              title="Nenhum desenho"
              description="Desenhe a medida à mão no tablet — dá para reabrir e continuar depois."
            />
          ) : (
            <div className="space-y-2">{drawings.map((a) => row(a, () => openEditSketch(a)))}</div>
          )}
        </TabsContent>
      </Tabs>

      {/* upload de arquivo */}
      <Dialog open={upOpen} onOpenChange={setUpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anexar arquivo à medição</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Arquivo</Label>
              <Input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                onChange={(e) => setUpForm({ ...upForm, file: e.target.files?.[0] ?? null })}
              />
            </div>
            <div className="space-y-2">
              <Label>Título (opcional)</Label>
              <Input
                value={upForm.title}
                onChange={(e) => setUpForm({ ...upForm, title: e.target.value })}
                placeholder="Ex.: Foto da parede da cozinha"
              />
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea rows={2} value={upForm.notes} onChange={(e) => setUpForm({ ...upForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={upload.isPending || !upForm.file} onClick={() => upload.mutate()}>
              {upload.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* prancheta */}
      <Dialog open={sketchOpen} onOpenChange={(v) => !v && setSketchOpen(false)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editing ? "Continuar desenho" : "Desenho da medição"}
              {editing && <Badge variant="muted">{editing.fileName}</Badge>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Título</Label>
              <Input
                value={sketchTitle}
                onChange={(e) => setSketchTitle(e.target.value)}
                placeholder="Ex.: Cozinha — parede da pia"
              />
            </div>
            <SketchPad key={`${editing?.id ?? "novo"}-${baseUrl ?? ""}`} initialImageUrl={baseUrl} registerGetter={registerGetter} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSketchOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={saveSketch.isPending} onClick={() => saveSketch.mutate()}>
              {saveSketch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar desenho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
