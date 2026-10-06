import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Loader2, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, apiGet, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Contractor = { id: string; name: string; hasLogin: boolean; present: number; absent: number; none: number };
type Rec = { contractorId: string; date: string; present: boolean; notes: string | null };
type Data = { from: string; to: string; days: string[]; today: string; contractors: Contractor[]; records: Rec[]; selfCheckIns: { contractorId: string; date: string }[] };

const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const label = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return { wd: WEEKDAY[d.getUTCDay()], dm: `${iso.slice(8, 10)}/${iso.slice(5, 7)}` }; };
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Presença dos montadores externos lançada pelo escritório: veio ou não veio, dia a dia. */
export function ContractorAttendance() {
  const qc = useQueryClient();
  const [from, setFrom] = useState<string | undefined>();
  const key = ["contractor-attendance", from ?? "atual"];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: Data }>("/contractors/attendance", from ? { from } : undefined), placeholderData: (prev) => prev });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["contractor-attendance"] }); qc.invalidateQueries({ queryKey: ["contractors"] }); };
  const mark = useMutation({
    mutationFn: (v: { contractorId: string; date: string; present: boolean | null }) =>
      v.present === null ? api<{ message?: string }>("/contractors/attendance", { method: "DELETE", body: { contractorId: v.contractorId, date: v.date } }) : apiPut<{ message?: string }>("/contractors/attendance", v),
    onSuccess: (r) => { if (r.message) toast.success(r.message); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível lançar a presença")),
  });

  if (q.isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const d = q.data?.data;
  if (!d) return <p className="py-6 text-sm text-muted-foreground">Não foi possível carregar a presença.</p>;

  const rec = new Map(d.records.map((r) => [`${r.contractorId}|${r.date}`, r.present]));
  const self = new Set(d.selfCheckIns.map((s) => `${s.contractorId}|${s.date}`));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><UserCheck className="h-4 w-4" /> Presença dos montadores</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Marque quem veio e quem não veio. O dia marcado como “veio” entra no fechamento com a diária do montador.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setFrom(shift(d.from, -7))} title="Semana anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-[130px] text-center text-sm font-medium">{label(d.from).dm} a {label(d.to).dm}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={shift(d.from, 7) > d.today} onClick={() => setFrom(shift(d.from, 7))} title="Próxima semana"><ChevronRight className="h-4 w-4" /></Button>
          {from && <Button variant="ghost" size="sm" onClick={() => setFrom(undefined)}>Hoje</Button>}
        </div>
      </CardHeader>
      <CardContent>
        {!d.contractors.length ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhum montador ativo cadastrado. Cadastre na aba Equipe.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">Montador</th>
                  {d.days.map((day) => <th key={day} className={cn("px-1 py-2 text-center font-medium", day === d.today && "text-primary")}><span className="block uppercase">{label(day).wd}</span>{label(day).dm}</th>)}
                  <th className="px-2 py-2 text-center font-medium">Veio</th>
                  <th className="px-2 py-2 text-center font-medium">Faltou</th>
                </tr>
              </thead>
              <tbody>
                {d.contractors.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{c.name}</span>
                      {!c.hasLogin && <Badge variant="outline" className="ml-2 text-[10px]">sem login</Badge>}
                    </td>
                    {d.days.map((day) => {
                      const k = `${c.id}|${day}`;
                      const v = rec.get(k);
                      const own = v === undefined && self.has(k);
                      const future = day > d.today;
                      return (
                        <td key={day} className="px-1 py-1.5 text-center">
                          <div className="inline-flex overflow-hidden rounded-md border">
                            <button type="button" disabled={future || mark.isPending} onClick={() => mark.mutate({ contractorId: c.id, date: day, present: v === true ? null : true })} title={own ? "O montador bateu o ponto neste dia" : v === true ? "Veio (toque para limpar)" : "Marcar que veio"}
                              className={cn("flex h-8 w-8 items-center justify-center disabled:opacity-40", v === true ? "bg-emerald-600 text-white" : own ? "bg-emerald-100 text-emerald-700" : "hover:bg-muted")}>
                              <Check className="h-4 w-4" />
                            </button>
                            <button type="button" disabled={future || mark.isPending} onClick={() => mark.mutate({ contractorId: c.id, date: day, present: v === false ? null : false })} title={v === false ? "Não veio (toque para limpar)" : "Marcar que não veio"}
                              className={cn("flex h-8 w-8 items-center justify-center border-l disabled:opacity-40", v === false ? "bg-destructive text-white" : "hover:bg-muted")}>
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 text-center font-semibold tabular-nums text-emerald-700">{c.present}</td>
                    <td className="px-2 text-center font-semibold tabular-nums text-destructive">{c.absent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">Verde claro: o próprio montador bateu o ponto naquele dia. Tocar de novo no botão marcado limpa o lançamento.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
