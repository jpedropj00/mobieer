import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Plus, RefreshCw, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type MaterialLine = { id: string; room: string; material: string; qty: number | null; unit: "chapa" | "m" | "un"; bought: boolean; boughtAt?: string | null; boughtBy?: string | null; note?: string | null; source: "PROMOB" | "MANUAL" };
export type MaterialSummary = { total: number; bought: number; pending: number; done: boolean };
type ListData = { lines: MaterialLine[]; summary: MaterialSummary; importedAt?: string | null; imports?: { id: string; fileName: string; format: string; createdAt: string }[] };

const EDGE_ROOM = "Fitas de borda";

export function qtyText(l: Pick<MaterialLine, "qty" | "unit">) {
  if (l.qty == null) return "";
  if (l.unit === "m") return `${l.qty} m`;
  if (l.unit === "chapa") return `${l.qty} ${l.qty === 1 ? "chapa" : "chapas"}`;
  return `${l.qty} un`;
}

export function groupByRoom(lines: MaterialLine[]) {
  const map = new Map<string, { room: string; lines: MaterialLine[] }>();
  for (const l of lines) {
    const k = l.room.trim().toLowerCase();
    if (!map.has(k)) map.set(k, { room: l.room.trim() || "Geral", lines: [] });
    map.get(k)!.lines.push(l);
  }
  const groups = [...map.values()];
  return [...groups.filter((g) => g.room !== EDGE_ROOM), ...groups.filter((g) => g.room === EDGE_ROOM)];
}

/** Uma linha da lista: toque para marcar como comprado. */
export function MaterialRow({ line, onToggle, onRemove, busy }: { line: MaterialLine; onToggle: () => void; onRemove?: () => void; busy?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <button type="button" disabled={busy} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-0.5 text-left hover:bg-muted/60" title={line.bought ? "Marcar como não comprado" : "Marcar como comprado"}>
        {line.bought ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}
        <span className={cn("min-w-0 flex-1 truncate text-sm", line.bought && "text-muted-foreground line-through")}>{line.material}</span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{qtyText(line)}</span>
      </button>
      {line.bought && line.boughtBy && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{line.boughtBy.split(" ")[0]}</span>}
      {onRemove && (
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onRemove} title="Remover da lista">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

/** Lista de materiais a comprar do projeto (aba do projeto). */
export function MaterialsListPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["materials-list", projectId];
  const base = `/production/projects/${projectId}/materials`;
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: ListData }>(base) });
  const [form, setForm] = useState({ room: "", material: "", qty: "" });

  const done = (r: { data: ListData; message?: string }) => {
    qc.setQueryData(key, (old: { data: ListData } | undefined) => ({ ...old, data: { ...old?.data, ...r.data } }));
    qc.invalidateQueries({ queryKey: ["materials-all"] });
    if (r.message) toast.success(r.message);
  };
  const fail = (e: unknown) => toast.error(errorMessage(e, "Não foi possível atualizar a lista"));
  const importPromob = useMutation({ mutationFn: () => apiPost<{ data: ListData; message?: string }>(`${base}/import`, {}), onSuccess: done, onError: fail });
  const toggle = useMutation({ mutationFn: (l: MaterialLine) => apiPatch<{ data: ListData }>(`${base}/lines/${l.id}`, { bought: !l.bought }), onSuccess: done, onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete<{ data: ListData; message?: string }>(`${base}/lines/${id}`), onSuccess: done, onError: fail });
  const add = useMutation({
    mutationFn: () => apiPost<{ data: ListData; message?: string }>(`${base}/lines`, { room: form.room.trim(), material: form.material.trim(), qty: form.qty ? Number(form.qty.replace(",", ".")) : null, unit: "chapa" }),
    onSuccess: (r) => { done(r); setForm((f) => ({ ...f, material: "", qty: "" })); },
    onError: fail,
  });

  if (q.isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const d = q.data?.data;
  if (!d) return <p className="py-6 text-sm text-muted-foreground">Não foi possível carregar a lista de materiais.</p>;
  const groups = groupByRoom(d.lines);
  const hasImport = (d.imports?.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><ShoppingCart className="h-4 w-4" /> Materiais a comprar</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {d.lines.length ? `${d.summary.bought} de ${d.summary.total} comprados` : "Chapas e fitas de cada ambiente, para marcar o que já foi comprado."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {d.lines.length > 0 && <Badge variant={d.summary.done ? "default" : "secondary"}>{d.summary.done ? "Tudo comprado" : `${d.summary.pending} pendente${d.summary.pending === 1 ? "" : "s"}`}</Badge>}
          {canManage && (
            <Button variant="outline" size="sm" disabled={!hasImport || importPromob.isPending} onClick={() => importPromob.mutate()} title={hasImport ? "Usa o arquivo mais recente lido na aba Promob" : "Envie primeiro o CSV do plano de corte na aba Promob"}>
              {importPromob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {d.lines.length ? "Atualizar do Promob" : "Puxar do Promob"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!d.lines.length && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {hasImport ? "Toque em “Puxar do Promob” para montar a lista com as chapas e fitas do arquivo, ou adicione os materiais abaixo." : "Este projeto ainda não tem arquivo do Promob lido. Envie o CSV do plano de corte na aba Promob, ou adicione os materiais abaixo."}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.room}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.room}</p>
            <div className="divide-y">
              {g.lines.map((l) => (
                <MaterialRow key={l.id} line={l} busy={toggle.isPending} onToggle={() => toggle.mutate(l)} onRemove={canManage ? () => remove.mutate(l.id) : undefined} />
              ))}
            </div>
          </div>
        ))}
        <form className="grid gap-2 border-t pt-4 sm:grid-cols-[1fr_2fr_90px_auto]" onSubmit={(e) => { e.preventDefault(); if (form.room.trim() && form.material.trim()) add.mutate(); else toast.error("Informe o ambiente e o material"); }}>
          <Input placeholder="Ambiente (ex.: Sala)" list={`rooms-${projectId}`} value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
          <datalist id={`rooms-${projectId}`}>{groups.map((g) => <option key={g.room} value={g.room} />)}</datalist>
          <Input placeholder="Material (ex.: Carvalho Treviso 15mm)" value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} />
          <Input placeholder="Chapas" inputMode="decimal" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value.replace(/[^0-9.,]/g, "") })} />
          <Button type="submit" variant="outline" disabled={add.isPending}><Plus className="h-4 w-4" /> Adicionar</Button>
        </form>
      </CardContent>
    </Card>
  );
}
