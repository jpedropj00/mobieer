import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileCode2, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiDelete, apiDownload, apiGet, apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/utils";

type ParsedItem = { descricao: string; referencia?: string | null; quantidade?: number | null; ambiente?: string | null };
type Parsed = { ambientes: string[]; itens: ParsedItem[]; totals: { ambientes: number; itens: number } };
type PromobImport = {
  id: string;
  fileName: string;
  sizeBytes: number;
  format: "XML" | "PDF" | "OTHER";
  status: "UPLOADED" | "PARSED" | "PARSE_FAILED";
  itemCount: number;
  parsed: Parsed | null;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  downloadUrl: string;
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
      if (fileRef.current) fileRef.current.value = "";
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao importar")),
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
            Envie o arquivo exportado do Promob (orçamento em <strong>.xml</strong>, ou o PDF). O sistema guarda o arquivo
            e, quando for XML, tenta extrair ambientes e itens automaticamente.
          </p>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Input ref={fileRef} type="file" accept=".xml,.pdf,.json,.txt" className="max-w-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Button size="sm" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
                {upload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Importar
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
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(imp.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
