import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { cn, formatCurrency } from "@/lib/utils";

type Goal = { id: string; title: string; cost: number; saved: number; targetDate: string | null; notes: string | null; done: boolean; doneAt: string | null; remaining: number; percent: number };
type Data = { goals: Goal[]; summary: { open: number; done: number; planned: number; saved: number; remaining: number; doneValue: number } };

const blank = { title: "", cost: "", saved: "", targetDate: "", notes: "" };
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;
const br = (iso: string) => iso.split("-").reverse().join("/");

/** Metas de investimento: o que a loja quer implantar e quanto custa. */
export function FinanceInvestments({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["finance", "investment-goals"];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: Data }>("/finance/investment-goals") });
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);

  const done = (r: { data: Data; message?: string }) => { qc.setQueryData(key, { data: r.data }); if (r.message) toast.success(r.message); };
  const fail = (e: unknown) => toast.error(errorMessage(e, "Não foi possível salvar a meta"));
  const body = () => ({ title: form.title.trim(), cost: num(form.cost), saved: num(form.saved), targetDate: form.targetDate || null, notes: form.notes.trim() || null });
  const save = useMutation({
    mutationFn: () => (editing ? apiPatch<{ data: Data; message?: string }>(`/finance/investment-goals/${editing}`, body()) : apiPost<{ data: Data; message?: string }>("/finance/investment-goals", body())),
    onSuccess: (r) => { done(r); setForm(blank); setEditing(null); },
    onError: fail,
  });
  const toggle = useMutation({ mutationFn: (g: Goal) => apiPatch<{ data: Data; message?: string }>(`/finance/investment-goals/${g.id}`, { done: !g.done }), onSuccess: (r) => done({ data: r.data }), onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete<{ data: Data; message?: string }>(`/finance/investment-goals/${id}`), onSuccess: done, onError: fail });

  if (q.isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const d = q.data?.data;
  if (!d) return <p className="py-6 text-sm text-muted-foreground">Não foi possível carregar as metas de investimento.</p>;

  const edit = (g: Goal) => { setEditing(g.id); setForm({ title: g.title, cost: String(g.cost).replace(".", ","), saved: g.saved ? String(g.saved).replace(".", ",") : "", targetDate: g.targetDate ?? "", notes: g.notes ?? "" }); };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Planejado (em aberto)</p><p className="text-xl font-bold">{formatCurrency(d.summary.planned)}</p><p className="text-xs text-muted-foreground">{d.summary.open} {d.summary.open === 1 ? "meta" : "metas"}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Já reservado</p><p className="text-xl font-bold text-emerald-600">{formatCurrency(d.summary.saved)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Falta</p><p className="text-xl font-bold">{formatCurrency(d.summary.remaining)}</p>{d.summary.done > 0 && <p className="text-xs text-muted-foreground">{d.summary.done} já implantada{d.summary.done === 1 ? "" : "s"} ({formatCurrency(d.summary.doneValue)})</p>}</CardContent></Card>
      </div>

      {canManage && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4" /> {editing ? "Editar meta" : "Nova meta de investimento"}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-6" onSubmit={(e) => { e.preventDefault(); if (form.title.trim().length < 2) return void toast.error("Informe o que vocês querem implantar"); save.mutate(); }}>
              <div className="space-y-1 sm:col-span-3"><Label className="text-xs">O que queremos implantar</Label><Input placeholder="Ex.: Coladeira de borda nova" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Quanto custa (R$)</Label><Input inputMode="decimal" placeholder="0,00" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value.replace(/[^0-9.,]/g, "") })} /></div>
              <div className="space-y-1"><Label className="text-xs">Já reservado (R$)</Label><Input inputMode="decimal" placeholder="0,00" value={form.saved} onChange={(e) => setForm({ ...form, saved: e.target.value.replace(/[^0-9.,]/g, "") })} /></div>
              <div className="space-y-1"><Label className="text-xs">Para quando</Label><Input type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-4"><Label className="text-xs">Observação (opcional)</Label><Input placeholder="Fornecedor, motivo, forma de pagamento…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              <div className="flex items-end gap-2 sm:col-span-2">
                <Button type="submit" disabled={save.isPending}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {editing ? "Salvar" : "Adicionar"}</Button>
                {editing && <Button type="button" variant="ghost" onClick={() => { setEditing(null); setForm(blank); }}>Cancelar</Button>}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {!d.goals.length && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma meta de investimento ainda. Cadastre o que a loja quer implantar e o valor.</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {d.goals.map((g) => (
          <Card key={g.id} className={cn(g.done && "opacity-70")}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <button type="button" disabled={!canManage || toggle.isPending} onClick={() => toggle.mutate(g)} className="flex min-w-0 items-start gap-2 text-left" title={g.done ? "Marcar como não implantada" : "Marcar como implantada"}>
                  {g.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
                  <span className={cn("font-medium", g.done && "line-through")}>{g.title}</span>
                </button>
                <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(g.cost)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${g.percent}%` }} /></div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{g.done ? "Implantada" : `${formatCurrency(g.saved)} reservado · falta ${formatCurrency(g.remaining)}`}</span>
                <span className="flex items-center gap-1.5">
                  {g.targetDate && !g.done && <Badge variant="secondary">até {br(g.targetDate)}</Badge>}
                  {canManage && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => edit(g)} title="Editar"><Pencil className="h-3.5 w-3.5" /></Button>}
                  {canManage && <Button variant="ghost" size="icon" className="h-7 w-7" disabled={remove.isPending} onClick={() => remove.mutate(g.id)} title="Remover"><Trash2 className="h-3.5 w-3.5" /></Button>}
                </span>
              </div>
              {g.notes && <p className="text-xs text-muted-foreground">{g.notes}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Categorias criadas pela loja + campo para acrescentar uma nova, usados no formulário de lançamento. */
export function useCustomCategories() {
  const qc = useQueryClient();
  const key = ["finance", "custom-categories"];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: { RECEITA: string[]; DESPESA: string[] } }>("/finance/custom-categories"), staleTime: 60_000 });
  const add = useMutation({
    mutationFn: (v: { type: "RECEITA" | "DESPESA"; name: string; builtin: string[] }) => apiPost<{ data: { RECEITA: string[]; DESPESA: string[] }; message?: string }>("/finance/custom-categories", v),
    onSuccess: (r) => { qc.setQueryData(key, { data: r.data }); toast.success(r.message ?? "Categoria adicionada"); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível adicionar a categoria")),
  });
  return { custom: q.data?.data ?? { RECEITA: [], DESPESA: [] }, add };
}
