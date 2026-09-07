import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageSkeleton } from "@/components/ui/states";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/services/api";
import { cn, errorMessage } from "@/lib/utils";

type Note = { id: string; title: string | null; body: string; pinned: boolean; color: string | null; updatedAt: string };
type PlannerItem = { id: string; weekOf: string; weekday: number; text: string; done: boolean; position: number };

const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return x;
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const fmtDay = (weekOf: string, weekday: number) => {
  const d = new Date(`${weekOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weekday);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

/* ============================ notas ============================ */

function Notes() {
  const qc = useQueryClient();
  const key = ["workspace", "notes"];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: Note[] }>("/workspace/notes") });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const [draft, setDraft] = useState({ title: "", body: "" });
  const create = useMutation({
    mutationFn: () => apiPost("/workspace/notes", draft),
    onSuccess: () => { setDraft({ title: "", body: "" }); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao criar nota")),
  });
  const patch = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Note> }) => apiPatch(`/workspace/notes/${id}`, data),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/workspace/notes/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });

  if (q.isLoading) return <PageSkeleton />;
  const notes = q.data?.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Nova nota</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Título (opcional)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <Textarea rows={3} placeholder="Escreva aqui…" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <div className="flex justify-end">
            <Button size="sm" disabled={create.isPending || draft.body.trim().length === 0} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      {notes.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem notas ainda.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((n) => (
            <div key={n.id} className={cn("rounded-lg border border-border bg-card p-3", n.pinned && "ring-1 ring-primary/40")}>
              <div className="flex items-start justify-between gap-2">
                {n.title ? <p className="text-sm font-semibold">{n.title}</p> : <span />}
                <div className="flex shrink-0 gap-1">
                  <button className="text-muted-foreground hover:text-foreground" title={n.pinned ? "Desafixar" : "Fixar"} onClick={() => patch.mutate({ id: n.id, data: { pinned: !n.pinned } })}>
                    {n.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </button>
                  <button className="text-muted-foreground hover:text-destructive" title="Remover" onClick={() => remove.mutate(n.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <Textarea
                rows={Math.min(10, Math.max(2, n.body.split("\n").length))}
                defaultValue={n.body}
                className="mt-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                onBlur={(e) => e.target.value !== n.body && patch.mutate({ id: n.id, data: { body: e.target.value } })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================ planner semanal ============================ */

function Planner() {
  const qc = useQueryClient();
  const [weekOf, setWeekOf] = useState(() => isoDate(mondayOf(new Date())));
  const key = ["workspace", "planner", weekOf];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: { weekOf: string; items: PlannerItem[] } }>("/workspace/planner", { weekOf }) });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const add = useMutation({
    mutationFn: ({ weekday, text }: { weekday: number; text: string }) => apiPost("/workspace/planner", { weekOf, weekday, text }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e, "Falha ao adicionar")),
  });
  const patch = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PlannerItem> }) => apiPatch(`/workspace/planner/${id}`, data),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/workspace/planner/${id}`), onSuccess: invalidate });

  const shift = (days: number) => {
    const d = new Date(`${weekOf}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    setWeekOf(isoDate(mondayOf(d)));
  };

  const byDay = useMemo(() => {
    const m: Record<number, PlannerItem[]> = {};
    for (let i = 0; i < 7; i++) m[i] = [];
    for (const it of q.data?.data.items ?? []) (m[it.weekday] ??= []).push(it);
    return m;
  }, [q.data]);

  const weekLabel = (() => {
    const a = new Date(`${weekOf}T00:00:00Z`);
    const b = new Date(a); b.setUTCDate(b.getUTCDate() + 6);
    return `${a.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${b.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => shift(-7)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium">{weekLabel}</span>
          <Button size="sm" variant="outline" onClick={() => shift(7)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setWeekOf(isoDate(mondayOf(new Date())))}>Esta semana</Button>
      </div>

      {q.isLoading ? (
        <PageSkeleton />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {WEEKDAYS.map((label, wd) => (
            <div key={wd} className="rounded-lg border border-border bg-card p-2.5">
              <p className="mb-1.5 text-xs font-semibold">
                {label} <span className="font-normal text-muted-foreground">{fmtDay(weekOf, wd)}</span>
              </p>
              <div className="space-y-1">
                {byDay[wd].map((it) => (
                  <div key={it.id} className="group flex items-start gap-1.5 text-xs">
                    <input type="checkbox" checked={it.done} className="mt-0.5" onChange={() => patch.mutate({ id: it.id, data: { done: !it.done } })} />
                    <span className={cn("flex-1", it.done && "text-muted-foreground line-through")}>{it.text}</span>
                    <button className="text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive" onClick={() => remove.mutate(it.id)}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <Input
                className="mt-1.5 h-7 text-xs"
                placeholder="+ item"
                value={drafts[wd] ?? ""}
                onChange={(e) => setDrafts((s) => ({ ...s, [wd]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (drafts[wd] ?? "").trim()) {
                    add.mutate({ weekday: wd, text: drafts[wd].trim() });
                    setDrafts((s) => ({ ...s, [wd]: "" }));
                  }
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================ page ============================ */

export function WorkspacePage() {
  const [tab, setTab] = useState<"notas" | "planner">("notas");
  return (
    <div className="space-y-6">
      <PageHeader title="Meu espaço" description="Bloco de notas e planner semanal — só você vê." />
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "notas" ? "default" : "outline"} onClick={() => setTab("notas")}>Notas</Button>
        <Button size="sm" variant={tab === "planner" ? "default" : "outline"} onClick={() => setTab("planner")}>Planner semanal</Button>
      </div>
      {tab === "notas" ? <Notes /> : <Planner />}
    </div>
  );
}
