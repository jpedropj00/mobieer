import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitCompare } from "lucide-react";
import { apiGet } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Status = "IGUAL" | "ALTERADA" | "EXCLUIDA" | "NOVA";
type Row = { status: Status; key: string; ambiente: string | null; descricao: string; referencia: string | null; changes: { label: string; before: string | number | null; after: string | number | null }[] };
type Diff = { summary: { iguais: number; alteradas: number; excluidas: number; novas: number }; rows: Row[] };
type Imp = { id: string; fileName: string; createdAt: string; status: string };

const LABEL: Record<Status, { text: string; variant: "muted" | "warning" | "danger" | "success" }> = {
  IGUAL: { text: "Igual", variant: "muted" },
  ALTERADA: { text: "Alterada", variant: "warning" },
  EXCLUIDA: { text: "Excluída", variant: "danger" },
  NOVA: { text: "Nova", variant: "success" },
};
const fmt = (v: string | number | null) => (v == null || v === "" ? "—" : String(v));

/** Compara duas listas de peças do mesmo projeto (ex.: orçamento x executivo). */
export function PromobCompareButton({ imports }: { imports: Imp[] }) {
  const parsed = imports.filter((i) => i.status === "PARSED");
  const [open, setOpen] = useState(false);
  // padrão: a penúltima contra a mais recente (a lista vem da mais nova para a mais velha)
  const [before, setBefore] = useState(parsed[1]?.id ?? "");
  const [after, setAfter] = useState(parsed[0]?.id ?? "");
  const [filter, setFilter] = useState<Status | "MUDOU">("MUDOU");
  const q = useQuery({
    queryKey: ["promob-compare", before, after],
    queryFn: () => apiGet<{ data: Diff }>(`/promob/imports/${before}/compare/${after}`),
    enabled: open && Boolean(before && after) && before !== after,
    retry: false,
  });
  if (parsed.length < 2) return null;
  const d = q.data?.data;
  const rows = (d?.rows ?? []).filter((r) => (filter === "MUDOU" ? r.status !== "IGUAL" : r.status === filter));
  const label = (i: Imp) => `${i.fileName} · ${new Date(i.createdAt).toLocaleDateString("pt-BR")}`;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><GitCompare className="mr-1 h-4 w-4" /> Comparar listas</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>Comparar listas de peças</DialogTitle></DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1 text-xs"><span className="text-muted-foreground">Versão anterior</span>
              <Select value={before} onValueChange={setBefore}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{parsed.map((i) => <SelectItem key={i.id} value={i.id}>{label(i)}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1 text-xs"><span className="text-muted-foreground">Versão nova</span>
              <Select value={after} onValueChange={setAfter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{parsed.map((i) => <SelectItem key={i.id} value={i.id}>{label(i)}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          {before === after && <p className="text-sm text-muted-foreground">Escolha duas importações diferentes.</p>}
          {q.isError && <p className="text-sm text-destructive">{errorMessage(q.error, "Não foi possível comparar")}</p>}
          {d && (
            <>
              <div className="flex flex-wrap gap-2">
                {([["MUDOU", `Só o que mudou (${d.summary.alteradas + d.summary.novas + d.summary.excluidas})`], ["ALTERADA", `Alteradas (${d.summary.alteradas})`], ["NOVA", `Novas (${d.summary.novas})`], ["EXCLUIDA", `Excluídas (${d.summary.excluidas})`], ["IGUAL", `Iguais (${d.summary.iguais})`]] as const).map(([k, t]) => (
                  <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>{t}</Button>
                ))}
              </div>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nada nesta situação.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Situação</TableHead><TableHead>Ambiente</TableHead><TableHead>Peça</TableHead><TableHead>O que mudou</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={`${r.status}-${r.key}`}>
                        <TableCell><Badge variant={LABEL[r.status].variant}>{LABEL[r.status].text}</Badge></TableCell>
                        <TableCell>{r.ambiente ?? "—"}</TableCell>
                        <TableCell>{r.descricao}{r.referencia && <span className="block text-xs text-muted-foreground">ref. {r.referencia}</span>}</TableCell>
                        <TableCell className="text-xs">{r.changes.map((c) => <span key={c.label} className="block">{c.label}: {fmt(c.before)} → <strong>{fmt(c.after)}</strong></span>)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
