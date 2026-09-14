import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, PackageCheck, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPut } from "@/services/api";
import type { DispatchChecklist } from "@/types";
import { errorMessage } from "@/lib/utils";

type Form = {
  producaoCompleta: boolean;
  materialCompleto: boolean;
  ferragens: boolean;
  insumos: boolean;
  pendencia: boolean;
  pendenciaDescricao: string;
  notes: string;
};

const EMPTY: Form = {
  producaoCompleta: false,
  materialCompleto: false,
  ferragens: false,
  insumos: false,
  pendencia: false,
  pendenciaDescricao: "",
  notes: "",
};

const ITEMS: { key: keyof Form; label: string; hint: string }[] = [
  { key: "producaoCompleta", label: "Produção concluída", hint: "Todos os módulos saíram da fábrica" },
  { key: "materialCompleto", label: "Material completo", hint: "Peças conferidas contra o plano de corte" },
  { key: "ferragens", label: "Ferragens", hint: "Dobradiças, corrediças, puxadores separados" },
  { key: "insumos", label: "Insumos", hint: "Parafusos, fitas, silicone e afins" },
];

/**
 * Checklist de saída: conferência antes de o pedido ir para entrega.
 * Enquanto houver item não conferido ou pendência em aberto, o pedido não é
 * marcado como liberado.
 */
export function DispatchChecklistCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["production", "dispatch", projectId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiGet<{ data: DispatchChecklist | null }>(`/production/projects/${projectId}/dispatch`),
  });

  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  // Carrega o estado salvo uma vez; depois o formulário é a fonte da verdade.
  useEffect(() => {
    if (loaded || q.isLoading) return;
    const d = q.data?.data;
    if (d) {
      setForm({
        producaoCompleta: d.producaoCompleta,
        materialCompleto: d.materialCompleto,
        ferragens: d.ferragens,
        insumos: d.insumos,
        pendencia: d.pendencia,
        pendenciaDescricao: d.pendenciaDescricao ?? "",
        notes: d.notes ?? "",
      });
    }
    setLoaded(true);
  }, [q.data, q.isLoading, loaded]);

  const save = useMutation({
    mutationFn: () =>
      apiPut<{ data: DispatchChecklist; message?: string }>(`/production/projects/${projectId}/dispatch`, {
        ...form,
        pendenciaDescricao: form.pendencia ? form.pendenciaDescricao : null,
        notes: form.notes || null,
      }),
    onSuccess: (r) => {
      toast.success(r.data.ready ? "Conferido — liberado para saída" : "Checklist salvo");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar o checklist")),
  });

  const saved = q.data?.data ?? null;
  const ready = form.producaoCompleta && form.materialCompleto && form.ferragens && form.insumos && !form.pendencia;

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <PackageCheck className="h-4 w-4" /> Saída — conferência para entrega
          </span>
          {saved?.releasedAt ? (
            <Badge variant="success">
              <CheckCircle2 className="mr-1 h-3 w-3" /> Liberado em {new Date(saved.releasedAt).toLocaleDateString("pt-BR")}
            </Badge>
          ) : saved?.pendencia ? (
            <Badge variant="danger">
              <AlertTriangle className="mr-1 h-3 w-3" /> Com pendência
            </Badge>
          ) : (
            <Badge variant="muted">Em conferência</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <p className="py-2 text-center text-xs text-muted-foreground">Carregando…</p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {ITEMS.map((it) => (
                <div key={it.key} className="flex items-start gap-2 rounded-lg border border-border p-2.5">
                  <Switch
                    id={`chk-${it.key}`}
                    disabled={!canManage}
                    checked={form[it.key] as boolean}
                    onCheckedChange={(v) => setForm({ ...form, [it.key]: v })}
                  />
                  <div className="min-w-0">
                    <Label htmlFor={`chk-${it.key}`} className="text-sm">{it.label}</Label>
                    <p className="text-xs text-muted-foreground">{it.hint}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border p-2.5">
              <div className="flex items-start gap-2">
                <Switch
                  id="chk-pend"
                  disabled={!canManage}
                  checked={form.pendencia}
                  onCheckedChange={(v) => setForm({ ...form, pendencia: v, pendenciaDescricao: v ? form.pendenciaDescricao : "" })}
                />
                <div className="min-w-0 flex-1">
                  <Label htmlFor="chk-pend" className="text-sm">Material em pendência</Label>
                  <p className="text-xs text-muted-foreground">Marque e descreva o que está faltando</p>
                  {form.pendencia && (
                    <Textarea
                      className="mt-2"
                      rows={2}
                      disabled={!canManage}
                      value={form.pendenciaDescricao}
                      onChange={(e) => setForm({ ...form, pendenciaDescricao: e.target.value })}
                      placeholder="Ex.: faltam 4 dobradiças 35mm e 1 porta do módulo superior"
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Observações da saída</Label>
              <Textarea
                rows={2}
                disabled={!canManage}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            {canManage && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {ready ? "Tudo conferido — salvar libera o pedido para entrega." : "Marque todos os itens e resolva as pendências para liberar."}
                </p>
                <Button
                  size="sm"
                  disabled={save.isPending || (form.pendencia && !form.pendenciaDescricao.trim())}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar checklist
                </Button>
              </div>
            )}
            {saved?.checkedBy && (
              <p className="text-xs text-muted-foreground">
                Última conferência por {saved.checkedBy.name} em {new Date(saved.updatedAt).toLocaleString("pt-BR")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
