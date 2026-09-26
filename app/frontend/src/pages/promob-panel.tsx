import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Eye, FileCode2, Loader2, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiDelete, apiDownload, apiGet, apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/utils";

type ParsedItem = { descricao: string; referencia?: string | null; quantidade?: number | null; ambiente?: string | null };
type Peca = {
  descricao: string;
  quantidade: number;
  comprimento: number | null;
  largura: number | null;
  espessura: number | null;
  material: string | null;
  ambiente: string | null;
  modulo: string | null;
  borda: string | null;
};
type Parsed = {
  ambientes: string[];
  itens: ParsedItem[];
  totals: { ambientes: number; itens: number; valor?: number | null };
  // só no CSV de plano de corte
  pecas?: Peca[];
  materiais?: { material: string; pecas: number; areaM2: number }[];
  columns?: { recognized: Record<string, string>; unknown: string[]; delimiter: string };
  warnings?: string[];
};
type PromobImport = {
  id: string;
  fileName: string;
  sizeBytes: number;
  format: "XML" | "CSV" | "PDF" | "OTHER";
  status: "UPLOADED" | "PARSED" | "PARSE_FAILED";
  itemCount: number;
  parsed: Parsed | null;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  downloadUrl: string;
};

type Preview = {
  fileName: string;
  sizeBytes: number;
  format: PromobImport["format"];
  status: PromobImport["status"];
  itemCount: number;
  totalValue: number | null;
  parsed: Parsed | null;
  notes: string | null;
};
const FIELD_LABEL: Record<string, string> = {
  descricao: "Peça", quantidade: "Quantidade", comprimento: "Comprimento", largura: "Largura", espessura: "Espessura",
  material: "Material", ambiente: "Ambiente", modulo: "Módulo", referencia: "Referência", borda: "Fita/borda", valor: "Valor",
};

const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDate = (v: string) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<PromobImport["status"], { label: string; variant: "success" | "warning" | "muted" }> = {
  UPLOADED: { label: "Armazenado", variant: "muted" },
  PARSED: { label: "Lido", variant: "success" },
  PARSE_FAILED: { label: "Sem leitura automática", variant: "warning" },
};

export function PromobPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["promob", projectId];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: PromobImport[] }>(`/promob/projects/${projectId}/imports`) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      return apiPostForm(`/promob/projects/${projectId}/imports`, fd);
    },
    onSuccess: (r: unknown) => {
      toast.success((r as { message?: string })?.message ?? "Arquivo importado");
      setFile(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao importar")),
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const read = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      return apiPostForm<{ data: Preview }>(`/promob/projects/${projectId}/imports/preview`, fd);
    },
    onSuccess: (r) => setPreview(r.data),
    onError: (e) => toast.error(errorMessage(e, "Falha ao ler o arquivo")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/promob/imports/${id}`),
    onSuccess: () => { toast.success("Removido"); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });

  if (q.isLoading) return <PageSkeleton />;
  const rows = q.data?.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Importar do Promob</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Envie o arquivo exportado do Promob: orçamento em <strong>.xml</strong>, plano de corte/lista de peças em{" "}
            <strong>.csv</strong>, ou o PDF. Antes de salvar você confere o que foi lido: peças, medidas, materiais e
            colunas reconhecidas.
          </p>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Input ref={fileRef} type="file" accept=".xml,.csv,.tsv,.pdf,.json,.txt" className="max-w-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Button size="sm" disabled={!file || read.isPending} onClick={() => read.mutate()}>
                {read.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                Ler e conferir
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="Nenhuma importação" description="Nenhum arquivo do Promob foi enviado para este projeto." />
      ) : (
        rows.map((imp) => (
          <Card key={imp.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {imp.fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {imp.format} · {fmtSize(imp.sizeBytes)} · {fmtDate(imp.createdAt)}
                    {imp.createdBy ? ` · ${imp.createdBy.name}` : ""}
                  </p>
                </div>
                <Badge variant={STATUS[imp.status].variant}>{STATUS[imp.status].label}</Badge>
              </div>

              {imp.notes && <p className="text-xs text-muted-foreground">{imp.notes}</p>}

              {imp.parsed && (imp.parsed.totals.ambientes > 0 || imp.parsed.totals.itens > 0) && (
                <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
                  {imp.parsed.ambientes.length > 0 && (
                    <p>
                      <span className="font-medium">Ambientes ({imp.parsed.totals.ambientes}):</span>{" "}
                      {imp.parsed.ambientes.join(" · ")}
                    </p>
                  )}
                  <p className="font-medium">Itens ({imp.parsed.totals.itens}):</p>
                  {imp.parsed.itens.length > 0 && (
                    <div className="max-h-56 overflow-y-auto">
                      <table className="w-full">
                        <tbody>
                          {imp.parsed.itens.slice(0, 200).map((it, i) => (
                            <tr key={i} className="border-b border-border/40 last:border-0">
                              <td className="py-1 pr-2">{it.descricao}</td>
                              <td className="py-1 pr-2 text-muted-foreground">{it.referencia ?? ""}</td>
                              <td className="py-1 text-right text-muted-foreground">{it.quantidade ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {imp.parsed.itens.length > 200 && (
                        <p className="pt-1 text-muted-foreground">… e mais {imp.parsed.itens.length - 200} item(ns).</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    apiDownload(imp.downloadUrl.replace(/^\/api/, ""), imp.fileName).catch((e) =>
                      toast.error(errorMessage(e, "Falha ao baixar"))
                    )
                  }
                >
                  <Download className="mr-1 h-4 w-4" /> Baixar original
                </Button>
                {canManage && (
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => { if (confirm(`Remover a importação "${imp.fileName}"?`)) remove.mutate(imp.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
      {preview && <PreviewDialog preview={preview} saving={upload.isPending} onCancel={() => setPreview(null)} onConfirm={() => upload.mutate()} />}
    </div>
  );
}

/** §20 — o que seria importado, antes de gravar. */
function PreviewDialog({ preview: p, saving, onCancel, onConfirm }: { preview: Preview; saving: boolean; onCancel: () => void; onConfirm: () => void }) {
  const d = p.parsed;
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conferir antes de importar · {p.fileName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="muted">{p.format}</Badge>
            <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
            {d && <Badge variant="muted">{d.totals.itens} peça(s)/item(ns)</Badge>}
            {d && d.totals.ambientes > 0 && <Badge variant="muted">{d.totals.ambientes} ambiente(s)</Badge>}
          </div>
          {p.notes && (
            <p className="flex gap-2 rounded-md border-l-4 border-warning bg-warning/10 p-3 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> {p.notes}
            </p>
          )}
          {d?.columns && (
            <div className="text-xs">
              <p className="font-medium">Colunas reconhecidas (separador {d.columns.delimiter})</p>
              <p className="text-muted-foreground">
                {Object.entries(d.columns.recognized)
                  .map(([f, col]) => `${FIELD_LABEL[f] ?? f} ← "${col}"`)
                  .join(" · ")}
              </p>
              {d.columns.unknown.length > 0 && <p className="text-muted-foreground">Ignoradas: {d.columns.unknown.join(", ")}</p>}
            </div>
          )}
          {d?.materiais && d.materiais.length > 0 && (
            <div>
              <p className="mb-1 font-medium">Materiais</p>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left">Material</th>
                    <th className="text-right">Peças</th>
                    <th className="text-right">Área (m²)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.materiais.map((m) => (
                    <tr key={m.material} className="border-t">
                      <td className="py-1">{m.material}</td>
                      <td className="text-right">{m.pecas}</td>
                      <td className="text-right">{m.areaM2.toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d?.pecas && d.pecas.length > 0 ? (
            <div>
              <p className="mb-1 font-medium">Peças {d.pecas.length > 300 ? "(primeiras 300)" : ""}</p>
              <div className="max-h-72 overflow-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-muted-foreground">
                    <tr>
                      <th className="p-1 text-left">Ambiente / módulo</th>
                      <th className="p-1 text-left">Peça</th>
                      <th className="p-1 text-right">Qtd</th>
                      <th className="p-1 text-right">C × L × E (mm)</th>
                      <th className="p-1 text-left">Material</th>
                      <th className="p-1 text-left">Fita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.pecas.slice(0, 300).map((x, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-1 text-muted-foreground">{[x.ambiente, x.modulo].filter(Boolean).join(" / ")}</td>
                        <td className="p-1">{x.descricao}</td>
                        <td className="p-1 text-right">{x.quantidade}</td>
                        <td className="p-1 text-right">{[x.comprimento, x.largura, x.espessura].map((v) => v ?? "?").join(" × ")}</td>
                        <td className="p-1">{x.material ?? ""}</td>
                        <td className="p-1">{x.borda ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : d && d.itens.length > 0 ? (
            <div>
              <p className="mb-1 font-medium">Itens {d.itens.length > 300 ? "(primeiros 300)" : ""}</p>
              <div className="max-h-72 overflow-auto rounded border">
                <table className="w-full text-xs">
                  <tbody>
                    {d.itens.slice(0, 300).map((it, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-1 text-muted-foreground">{it.ambiente ?? ""}</td>
                        <td className="p-1">{it.descricao}</td>
                        <td className="p-1 text-muted-foreground">{it.referencia ?? ""}</td>
                        <td className="p-1 text-right">{it.quantidade ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={onConfirm}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {p.status === "PARSED" ? "Confirmar importação" : "Guardar o arquivo mesmo assim"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
