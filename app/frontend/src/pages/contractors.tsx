import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, HardHat, LogIn, LogOut, Loader2, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { KpiCard } from "@/components/kpi-card";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage, localIsoDate } from "@/lib/utils";
import type { Contractor, ContractorShift, ContractorSummary } from "@/types";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDateTime = (v: string) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const hhmm = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
const isoDay = (d: Date) => localIsoDate(d);

type ProjectRow = { id: string; name: string };

const EMPTY_FORM = { name: "", document: "", phone: "", address: "", specialty: "", dailyRate: "", notes: "" };

/**
 * Montadores terceirizados: cadastro, check-in/check-out na obra e o
 * fechamento por horas e diárias.
 */
export function ContractorsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("hr.employees.manage");

  const [tab, setTab] = useState("equipe");
  const [dialog, setDialog] = useState<null | "new" | "edit" | "checkin">(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<Contractor | null>(null);
  const [checkinFor, setCheckinFor] = useState<Contractor | null>(null);
  const [checkinProject, setCheckinProject] = useState("");

  const today = new Date();
  const [range, setRange] = useState({ from: isoDay(new Date(today.getTime() - 29 * 86400000)), to: isoDay(today) });

  const contractors = useQuery({ queryKey: ["contractors"], queryFn: () => apiGet<{ data: Contractor[] }>("/contractors") });
  const projects = useQuery({ queryKey: ["business-projects", "picklist"], queryFn: () => apiGet<{ data: ProjectRow[] }>("/business/projects") });
  const shifts = useQuery({
    queryKey: ["contractor-shifts", range],
    queryFn: () => apiGet<{ data: ContractorShift[] }>("/contractors/shifts", { from: range.from, to: range.to }),
  });
  const summary = useQuery({
    queryKey: ["contractor-summary", range],
    queryFn: () => apiGet<{ data: ContractorSummary }>("/contractors/summary", { from: range.from, to: range.to }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contractors"] });
    qc.invalidateQueries({ queryKey: ["contractor-shifts"] });
    qc.invalidateQueries({ queryKey: ["contractor-summary"] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        document: form.document || null,
        phone: form.phone || null,
        address: form.address || null,
        specialty: form.specialty || null,
        dailyRate: form.dailyRate.trim() === "" ? 0 : Number(form.dailyRate.replace(",", ".")),
        notes: form.notes || null,
      };
      return editing ? apiPatch(`/contractors/${editing.id}`, body) : apiPost("/contractors", body);
    },
    onSuccess: () => {
      toast.success(editing ? "Montador atualizado" : "Montador cadastrado");
      setDialog(null);
      setEditing(null);
      setForm(EMPTY_FORM);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });

  const toggleActive = useMutation({
    mutationFn: (c: Contractor) => apiPatch(`/contractors/${c.id}`, { active: !c.active }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e, "Falha")),
  });

  const removeContractor = useMutation({
    mutationFn: (id: string) => apiDelete<{ message?: string }>(`/contractors/${id}`),
    onSuccess: (r) => { toast.success(r.message ?? "Montador removido"); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });

  const checkIn = useMutation({
    mutationFn: () => apiPost(`/contractors/${checkinFor!.id}/check-in`, { projectId: checkinProject || null }),
    onSuccess: () => {
      toast.success("Check-in registrado");
      setDialog(null);
      setCheckinFor(null);
      setCheckinProject("");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha no check-in")),
  });

  const checkOut = useMutation({
    mutationFn: (shiftId: string) => apiPost<{ message?: string }>(`/contractors/shifts/${shiftId}/check-out`, {}),
    onSuccess: (r) => { toast.success(r.message ?? "Check-out registrado"); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Falha no check-out")),
  });

  const removeShift = useMutation({
    mutationFn: (id: string) => apiDelete(`/contractors/shifts/${id}`),
    onSuccess: () => { toast.success("Turno removido"); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao remover")),
  });

  const list = contractors.data?.data ?? [];
  const shiftList = shifts.data?.data ?? [];
  const sum = summary.data?.data;
  const openShifts = useMemo(() => shiftList.filter((s) => s.open), [shiftList]);

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setDialog("new"); };
  const openEdit = (c: Contractor) => {
    setEditing(c);
    setForm({
      name: c.name,
      document: c.document ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      specialty: c.specialty ?? "",
      dailyRate: String(c.dailyRate),
      notes: c.notes ?? "",
    });
    setDialog("edit");
  };

  if (contractors.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Montadores terceirizados"
        description="Check-in e check-out na obra, contagem de horas e fechamento por diária."
      >
        {canManage && (
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" /> Novo montador
          </Button>
        )}
      </PageHeader>

      {openShifts.length > 0 && (
        <Card className="border-primary/40">
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4" /> Na obra agora ({openShifts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {openShifts.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.contractor?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Entrou {fmtDateTime(s.checkInAt)}
                    {s.project ? ` · ${s.project.code} — ${s.project.name}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={checkOut.isPending} onClick={() => checkOut.mutate(s.id)}>
                  <LogOut className="mr-2 h-4 w-4" /> Check-out
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="equipe">Equipe ({list.length})</TabsTrigger>
          <TabsTrigger value="turnos">Turnos ({shiftList.length})</TabsTrigger>
          <TabsTrigger value="fechamento">Fechamento</TabsTrigger>
        </TabsList>

        <TabsContent value="equipe" className="space-y-4 pt-4">
          {list.length === 0 ? (
            <EmptyState title="Nenhum montador" description="Cadastre os terceirizados para controlar horas e diárias." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {list.map((c) => (
                <Card key={c.id} className={c.active ? "" : "opacity-60"}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-start justify-between gap-2 text-base">
                      <span className="flex-1">{c.name}</span>
                      {c.onSite ? <Badge variant="success">Na obra</Badge> : !c.active ? <Badge variant="muted">Inativo</Badge> : null}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="text-xs text-muted-foreground">
                      {[c.specialty, c.phone, c.document].filter(Boolean).join(" · ") || "—"}
                    </p>
                    {c.address && <p className="text-xs text-muted-foreground">{c.address}</p>}
                    <p className="font-medium">Diária: {brl(c.dailyRate)}</p>
                    {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {c.active && !c.onSite && (
                        <Button size="sm" onClick={() => { setCheckinFor(c); setCheckinProject(""); setDialog("checkin"); }}>
                          <LogIn className="mr-2 h-4 w-4" /> Check-in
                        </Button>
                      )}
                      {canManage && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate(c)}>
                            {c.active ? "Desativar" : "Ativar"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => { if (confirm(`Remover ${c.name}?`)) removeContractor.mutate(c.id); }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="turnos" className="space-y-4 pt-4">
          <PeriodPicker range={range} setRange={setRange} />
          {shiftList.length === 0 ? (
            <EmptyState title="Nenhum turno no período" description="Os check-ins feitos na aba Equipe aparecem aqui." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Montador</TableHead>
                    <TableHead>Obra</TableHead>
                    <TableHead>Entrada</TableHead>
                    <TableHead>Saída</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Diária</TableHead>
                    {canManage && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shiftList.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.contractor?.name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.project ? `${s.project.code} — ${s.project.name}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{fmtDateTime(s.checkInAt)}</TableCell>
                      <TableCell className="text-xs">
                        {s.checkOutAt ? fmtDateTime(s.checkOutAt) : <Badge variant="warning">em aberto</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.minutes != null ? hhmm(s.minutes) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(s.dailyRate)}</TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {s.open && (
                              <Button size="sm" variant="outline" onClick={() => checkOut.mutate(s.id)}>
                                <LogOut className="h-4 w-4" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeShift.mutate(s.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="fechamento" className="space-y-4 pt-4">
          <PeriodPicker range={range} setRange={setRange} />
          {sum && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard title="Montadores" value={String(sum.totals.contractors)} icon={HardHat} />
                <KpiCard title="Horas no período" value={`${sum.totals.hours.toFixed(1)}h`} icon={Clock} />
                <KpiCard title="Diárias" value={String(sum.totals.days)} icon={Clock} />
                <KpiCard title="Total a pagar" value={brl(sum.totals.total)} icon={Wallet} />
              </div>
              {sum.totals.openShifts > 0 && (
                <p className="rounded-md bg-warning/10 p-2 text-xs text-warning-foreground">
                  {sum.totals.openShifts} turno(s) ainda em aberto — as horas deles não entram no total até o check-out.
                </p>
              )}
              {sum.items.length === 0 ? (
                <EmptyState title="Nada no período" description="Escolha outro intervalo de datas." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Montador</TableHead>
                        <TableHead className="text-right">Horas</TableHead>
                        <TableHead className="text-right">Dias</TableHead>
                        <TableHead className="text-right">A pagar</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sum.items.map((i) => (
                        <TableRow key={i.contractorId}>
                          <TableCell className="font-medium">
                            {i.name}
                            {i.openShifts > 0 && <Badge variant="warning" className="ml-2">{i.openShifts} em aberto</Badge>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{i.hours.toFixed(1)}h</TableCell>
                          <TableCell className="text-right tabular-nums">{i.days}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{brl(i.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                O valor a pagar é <strong>dias trabalhados × diária</strong>. Dois turnos no mesmo dia contam como uma diária só.
                A diária usada é a que estava valendo no dia do check-in.
              </p>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Cadastro / edição */}
      <Dialog open={dialog === "new" || dialog === "edit"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Editar ${editing.name}` : "Novo montador terceirizado"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>CPF/CNPJ</Label>
              <Input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Endereço</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Especialidade</Label>
              <Input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} placeholder="Montagem, elétrica…" />
            </div>
            <div className="space-y-2">
              <Label>Valor da diária (R$)</Label>
              <Input inputMode="decimal" value={form.dailyRate} onChange={(e) => setForm({ ...form, dailyRate: e.target.value })} placeholder="180" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Observações</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check-in */}
      <Dialog open={dialog === "checkin"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check-in — {checkinFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Obra / projeto (opcional)</Label>
              <Select value={checkinProject || "NONE"} onValueChange={(v) => setCheckinProject(v === "NONE" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Nenhum</SelectItem>
                  {(projects.data?.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              O horário do check-in é o de agora. A diária registrada será {checkinFor ? brl(checkinFor.dailyRate) : "—"}.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button disabled={checkIn.isPending} onClick={() => checkIn.mutate()}>
              {checkIn.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
              Registrar check-in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PeriodPicker({ range, setRange }: { range: { from: string; to: string }; setRange: (r: { from: string; to: string }) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-2">
        <Label>De</Label>
        <Input type="date" className="w-44" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label>Até</Label>
        <Input type="date" className="w-44" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
    </div>
  );
}
