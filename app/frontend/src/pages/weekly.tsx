import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Flag, NotebookPen } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { PageSkeleton } from "@/components/ui/states";
import { apiGet, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Item = { id: string; area: string; title: string; detail: string; client: string | null; responsible: string | null; due: string | null; confirmed: boolean; critical: boolean; link: string | null };
type Entry = { date: string; time: string | null; title: string; kind: string; confirmed: boolean; link: string | null };
type Weekly = {
  weekStart: string;
  weekEnd: string;
  priorities: Item[];
  blockers: Item[];
  toConfirm: number;
  areas: { key: string; label: string; items: Item[] }[];
  days: { date: string; label: string; entries: Entry[] }[];
  total: number;
};

const br = (iso: string) => iso.split("-").reverse().join("/");
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const KIND: Record<string, string> = { MONTAGEM: "Montagem", MEDICAO: "Medição", ENTREGA: "Entrega", ASSISTENCIA: "Assistência", AGENDA: "Agenda" };

/**
 * Semana da Mobieer: o planejamento da semana montado com o que está no sistema.
 * Toda segunda às 8h quem gerencia recebe o aviso no sino com o link para cá.
 */
export function WeeklyPage() {
  const [week, setWeek] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["weekly", week], queryFn: () => apiGet<{ data: Weekly }>("/weekly", week ? { week } : undefined) });
  const w = q.data?.data;
  const current = w?.weekStart ?? week;

  const notes = useQuery({ queryKey: ["weekly-notes", current], queryFn: () => apiGet<{ data: { checked: string[]; notes: string } }>("/weekly/notes", { week: current! }), enabled: Boolean(current) });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!notes.data || loadedFor.current === current) return;
    loadedFor.current = current ?? null;
    setChecked(new Set(notes.data.data.checked));
    setText(notes.data.data.notes);
  }, [notes.data, current]);

  const save = useMutation({ mutationFn: (body: { checked: string[]; notes: string }) => apiPut("/weekly/notes", { week: current, ...body }) });
  // salva sozinho, um instante depois de marcar ou escrever
  useEffect(() => {
    if (!current || loadedFor.current !== current) return;
    const t = setTimeout(() => save.mutate({ checked: [...checked], notes: text }), 700);
    return () => clearTimeout(t);
  }, [checked, text]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (q.isLoading) return <PageSkeleton />;
  if (!w) return <p className="text-sm text-destructive">{errorMessage(q.error, "Não foi possível montar a semana")}</p>;

  const row = (it: Item) => (
    <label key={it.id} className={cn("flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50", checked.has(it.id) && "opacity-60")}>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={checked.has(it.id)} onChange={() => toggle(it.id)} />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium", checked.has(it.id) && "line-through")}>
          {it.link ? <Link to={it.link} className="hover:underline" onClick={(e) => e.stopPropagation()}>{it.title}</Link> : it.title}
        </span>
        <span className="block text-xs text-muted-foreground">
          {it.detail}
          {` · responsável: ${it.responsible ?? "a confirmar"}`}
          {it.due ? ` · ${br(it.due)}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {it.critical && <Badge variant="danger">Crítico</Badge>}
        {!it.confirmed && <Badge variant="warning">A confirmar</Badge>}
      </span>
    </label>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Semana da Mobieer" description={`Planejamento de ${br(w.weekStart)} a ${br(w.weekEnd)}, montado com o que está registrado no sistema. O que falta informação aparece como "a confirmar".`}>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="Semana anterior" onClick={() => setWeek(shift(w.weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={() => setWeek(null)}>Esta semana</Button>
          <Button size="icon" variant="outline" aria-label="Próxima semana" onClick={() => setWeek(shift(w.weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Flag className="h-4 w-4" /> As três prioridades da semana</CardTitle></CardHeader>
          <CardContent>
            {w.priorities.length === 0 ? <p className="text-sm text-muted-foreground">Nada crítico registrado para esta semana.</p> : (
              <ol className="space-y-1">{w.priorities.map((p) => row(p))}</ol>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" /> Pode travar entrega</CardTitle></CardHeader>
          <CardContent>
            {w.blockers.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma produção atrasada ou com itens sem baixa para esta semana.</p> : w.blockers.map((b) => row(b))}
            {w.toConfirm > 0 && <p className="mt-2 text-xs text-muted-foreground">{w.toConfirm} item(ns) com data ou confirmação pendente — marcados como “a confirmar”.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4" /> Agenda da semana</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="grid min-w-[640px] gap-2" style={{ gridTemplateColumns: `repeat(${w.days.length}, minmax(0, 1fr))` }}>
            {w.days.map((d) => (
              <div key={d.date} className="rounded-lg border border-border p-2">
                <p className="mb-2 text-xs font-semibold">{d.label}</p>
                {d.entries.length === 0 ? <p className="text-[11px] text-muted-foreground">—</p> : d.entries.map((e, i) => (
                  <div key={i} className={cn("mb-1.5 rounded-md border-l-2 bg-muted/40 px-2 py-1 text-[11px]", e.confirmed ? "border-success" : "border-warning")}>
                    <span className="font-medium">{e.time ? `${e.time} · ` : ""}{KIND[e.kind] ?? e.kind}</span>
                    <span className="block text-muted-foreground">{e.title}</span>
                    {!e.confirmed && <span className="text-warning">a confirmar</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {w.areas.map((a) => (
          <Card key={a.key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                {a.label}
                <Badge variant="secondary">{a.items.filter((i) => checked.has(i.id)).length}/{a.items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {a.items.length === 0 ? <p className="text-sm text-muted-foreground">Nada pendente registrado.</p> : <div className="space-y-0.5">{a.items.map((it) => row(it))}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><NotebookPen className="h-4 w-4" /> Anotações da semana</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          <Textarea rows={5} value={text} placeholder="Anotações gerais e de montagens…" onChange={(e) => setText(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">{save.isPending ? "Salvando…" : "As marcações e anotações ficam salvas para você nesta semana."}</p>
        </CardContent>
      </Card>
    </div>
  );
}
