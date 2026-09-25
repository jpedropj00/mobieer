import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiDownload, apiGet, apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type FileRecord = {
  id: string;
  entity: string;
  entityId: string;
  category: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  downloadUrl: string;
};

const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Anexos de qualquer registro do registro central de arquivos (§55). Quem pode
 * ver e anexar é decidido no backend pela entidade; `canWrite` só esconde os
 * botões para quem vai receber 403 de qualquer jeito.
 */
export function FileAttachments({
  entity,
  entityId,
  canWrite,
  category,
  onChange,
}: {
  entity: string;
  entityId: string;
  canWrite: boolean;
  category?: string;
  onChange?: () => void;
}) {
  const qc = useQueryClient();
  const key = ["files", entity, entityId];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: FileRecord[] }>("/files", { entity, entityId }) });
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    onChange?.();
  };

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("entity", entity);
        fd.append("entityId", entityId);
        if (category) fd.append("category", category);
        await apiPostForm("/files", fd);
      }
      return files.length;
    },
    onSuccess: (n) => {
      toast.success(n > 1 ? `${n} arquivos anexados` : "Arquivo anexado");
      if (input.current) input.current.value = "";
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao anexar")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/files/${id}`),
    onSuccess: () => {
      toast.success("Arquivo removido");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });

  const rows = q.data?.data ?? [];
  return (
    <div className="space-y-2">
      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando anexos...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum anexo.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.fileName}</span>
                <span className="shrink-0 text-muted-foreground">
                  {fmtSize(f.sizeBytes)} · {formatDate(f.createdAt)}
                  {f.createdBy ? ` · ${f.createdBy.name}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label={`Baixar ${f.fileName}`}
                  onClick={() => apiDownload(f.downloadUrl.replace(/^\/api/, ""), f.fileName).catch((e) => toast.error(errorMessage(e, "Falha ao baixar")))}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                {canWrite && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    aria-label={`Remover ${f.fileName}`}
                    disabled={remove.isPending}
                    onClick={() => {
                      if (confirm(`Remover o arquivo "${f.fileName}"?`)) remove.mutate(f.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) upload.mutate(files);
            }}
          />
          <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} Anexar
          </Button>
        </>
      )}
    </div>
  );
}
