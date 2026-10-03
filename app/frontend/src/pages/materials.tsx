import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MaterialRow, groupByRoom, type MaterialLine, type MaterialSummary } from "@/components/materials-list";
import { apiGet, apiPatch } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type List = { project: { id: string; code: string; name: string; client: string }; lines: MaterialLine[]; summary: MaterialSummary };

/** A folha "MATERIAIS" da semana: cliente → ambiente → material, com a marcação de comprado. */
export function MaterialsPage() {
  const qc = useQueryClient();
  const [onlyPending, setOnlyPending] = useState(true);
  const q = useQuery({ queryKey: ["materials-all"], queryFn: () => apiGet<{ data: List[] }>("/production/materials") });
  const toggle = useMutation({
    mutationFn: ({ projectId, line }: { projectId: string; line: MaterialLine }) => apiPatch(`/production/projects/${projectId}/materials/lines/${line.id}`, { bought: !line.bought }),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ["materials-all"] }); qc.invalidateQueries({ queryKey: ["materials-list", v.projectId] }); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível marcar")),
  });

  const all = q.data?.data ?? [];
  const lists = onlyPending ? all.filter((l) => !l.summary.done) : all;
  const pending = all.reduce((s, l) => s + l.summary.pending, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><ShoppingCart className="h-6 w-6" /> Compras de materiais</h1>
          <p className="text-sm text-muted-foreground">
            Chapas e fitas de cada cliente, por ambiente. {pending ? `${pending} ${pending === 1 ? "item" : "itens"} por comprar.` : "Nada pendente."}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border p-1">
          <Button size="sm" variant={onlyPending ? "default" : "ghost"} onClick={() => setOnlyPending(true)}>Com pendência</Button>
          <Button size="sm" variant={!onlyPending ? "default" : "ghost"} onClick={() => setOnlyPending(false)}>Todos</Button>
        </div>
      </div>

      {q.isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      {!q.isLoading && !lists.length && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {all.length ? "Tudo comprado. Use “Todos” para ver as listas concluídas." : "Nenhuma lista ainda. Abra um projeto, aba Materiais, e puxe a lista do arquivo do Promob."}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {lists.map((l) => (
          <Card key={l.project.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-3 py-4">
              <div className="min-w-0">
                <CardTitle className="truncate text-base">{l.project.client}</CardTitle>
                <Link to={`/clientes-projetos/${l.project.id}`} className="text-xs text-muted-foreground hover:underline">{l.project.code} — {l.project.name}</Link>
              </div>
              <Badge variant={l.summary.done ? "default" : "secondary"} className="shrink-0">{l.summary.bought}/{l.summary.total}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {groupByRoom(onlyPending ? l.lines.filter((x) => !x.bought) : l.lines).map((g) => (
                <div key={g.room}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.room}</p>
                  <div className="divide-y">
                    {g.lines.map((line) => <MaterialRow key={line.id} line={line} busy={toggle.isPending} onToggle={() => toggle.mutate({ projectId: l.project.id, line })} />)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
