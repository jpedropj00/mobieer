import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Clock, Loader2, Plus, Upload, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { apiGet, apiPatch, apiPost, apiPostForm } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/utils";
import type { Employee, HrAlert, TimeMirror, User, VacationRequest } from "@/types";

const hhmm = (min: number) => {
  const s = min < 0 ? "-" : "";
  const a = Math.abs(min);
  return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, "0")}`;
};
const DAY_STATUS: Record<string, { label: string; variant: "secondary" | "danger" | "success" | "warning" | "muted" }> = {
  OK: { label: "OK", variant: "success" },
  INCOMPLETO: { label: "Incompleto", variant: "warning" },
  FALTA: { label: "Falta", variant: "danger" },
  FOLGA: { label: "Folga", variant: "muted" },
};

const REQ_STATUS: Record<string, { label: string; variant: "secondary" | "outline" | "danger" | "success" | "warning" }> = {
  REQUESTED: { label: "Pendente", variant: "warning" },
  APPROVED: { label: "Aprovada", variant: "success" },
  SCHEDULED: { label: "Agendada", variant: "secondary" },
  TAKEN: { label: "Usufruída", variant: "secondary" },
  REJECTED: { label: "Recusada", variant: "danger" },
  CANCELLED: { label: "Cancelada", variant: "danger" },
};
const EMP_STATUS: Record<string, string> = { ACTIVE: "Ativo", ON_LEAVE: "Afastado", TERMINATED: "Desligado" };

const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const daysBetween = (a: string, b: string) =>
  a && b ? Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1 : 0;

export function HrPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canEmployees = can("hr.employees.manage");
  const canVacations = can("hr.vacations.manage");
  const canApprove = can("hr.vacations.approve");

  const employees = useQuery({ queryKey: ["hr", "employees"], queryFn: () => apiGet<{ data: Employee[] }>("/hr/employees") });
  const vacations = useQuery({ queryKey: ["hr", "vacations"], queryFn: () => apiGet<{ data: VacationRequest[] }>("/hr/vacations") });
  const alerts = useQuery({ queryKey: ["hr", "alerts"], queryFn: () => apiGet<{ data: HrAlert[] }>("/hr/alerts") });
  const users = useQuery({
    queryKey: ["users", "for-hr"],
    queryFn: () => apiGet<{ data: User[] }>("/users"),
    enabled: canEmployees,
  });

  const [dialog, setDialog] = useState<"employee" | "period" | "request" | "manualPunch" | null>(null);
  const [periodEmployeeId, setPeriodEmployeeId] = useState<string>("");
  const [empForm, setEmpForm] = useState({ fullName: "", role: "", sector: "", admittedAt: "", weeklyHours: "44", userId: "" });
  const [periodForm, setPeriodForm] = useState({ accrualStart: "", accrualEnd: "", daysEntitled: "30" });
  const [reqForm, setReqForm] = useState({ employeeId: "", startDate: "", endDate: "", sellDays: "0", note: "" });

  // Ponto
  const canTimeclock = can("hr.timeclock.manage");
  const [pontoEmp, setPontoEmp] = useState("");
  const [pontoMonth, setPontoMonth] = useState(new Date().toISOString().slice(0, 7));
  const [punch, setPunch] = useState({ timestamp: "", kind: "IN" });
  const pontoFileRef = useRef<HTMLInputElement>(null);
  const mirror = useQuery({
    queryKey: ["hr", "mirror", pontoEmp, pontoMonth],
    queryFn: () => apiGet<{ data: TimeMirror }>("/hr/timeclock/mirror", { employeeId: pontoEmp, month: pontoMonth }),
    enabled: Boolean(pontoEmp) && /^\d{4}-\d{2}$/.test(pontoMonth),
  });
  const importPonto = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return apiPostForm<{ data: { importadas: number; reconhecidas: number; semColaborador: number; linhasInvalidas: number } }>("/hr/timeclock/import", fd);
    },
    onSuccess: (r) => {
      toast.success(`Importado: ${r.data.importadas} marcações (${r.data.semColaborador} sem colaborador, ${r.data.linhasInvalidas} inválidas)`);
      qc.invalidateQueries({ queryKey: ["hr", "mirror"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao importar")),
  });
  const addPunch = useMutation({
    mutationFn: () => apiPost("/hr/timeclock/entries", { employeeId: pontoEmp, timestamp: punch.timestamp, kind: punch.kind }),
    onSuccess: () => {
      toast.success("Marcação registrada");
      setDialog(null);
      setPunch({ timestamp: "", kind: "IN" });
      qc.invalidateQueries({ queryKey: ["hr", "mirror"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao registrar")),
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["hr"] });
  };

  const createEmployee = useMutation({
    mutationFn: () =>
      apiPost("/hr/employees", {
        fullName: empForm.fullName,
        role: empForm.role || null,
        sector: empForm.sector || null,
        admittedAt: empForm.admittedAt,
        weeklyHours: Number(empForm.weeklyHours || 44),
        userId: empForm.userId || null,
      }),
    onSuccess: () => {
      toast.success("Colaborador cadastrado");
      setDialog(null);
      setEmpForm({ fullName: "", role: "", sector: "", admittedAt: "", weeklyHours: "44", userId: "" });
      refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao cadastrar")),
  });

  const createPeriod = useMutation({
    mutationFn: () =>
      apiPost(`/hr/employees/${periodEmployeeId}/periods`, {
        accrualStart: periodForm.accrualStart,
        accrualEnd: periodForm.accrualEnd,
        daysEntitled: Number(periodForm.daysEntitled || 30),
      }),
    onSuccess: () => {
      toast.success("Período aquisitivo criado");
      setDialog(null);
      setPeriodForm({ accrualStart: "", accrualEnd: "", daysEntitled: "30" });
      refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao criar período")),
  });

  const createRequest = useMutation({
    mutationFn: () =>
      apiPost("/hr/vacations", {
        employeeId: reqForm.employeeId,
        startDate: reqForm.startDate,
        endDate: reqForm.endDate,
        sellDays: Number(reqForm.sellDays || 0),
        note: reqForm.note || null,
      }),
    onSuccess: () => {
      toast.success("Solicitação registrada");
      setDialog(null);
      setReqForm({ employeeId: "", startDate: "", endDate: "", sellDays: "0", note: "" });
      refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha ao registrar")),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => apiPatch(`/hr/vacations/${id}`, { action }),
    onSuccess: () => {
      toast.success("Solicitação atualizada");
      refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e, "Falha na ação")),
  });

  const reqDays = useMemo(() => daysBetween(reqForm.startDate, reqForm.endDate), [reqForm.startDate, reqForm.endDate]);

  if (employees.isLoading) return <PageSkeleton />;

  const empList = employees.data?.data ?? [];
  const vacList = vacations.data?.data ?? [];
  const alertList = alerts.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="RH" description="Colaboradores, férias, alertas e ponto eletrônico." />

      <Tabs defaultValue="employees">
        <TabsList className="flex-wrap">
          <TabsTrigger value="employees">Colaboradores ({empList.length})</TabsTrigger>
          <TabsTrigger value="vacations">Férias ({vacList.length})</TabsTrigger>
          <TabsTrigger value="alerts">
            Alertas{alertList.length ? ` (${alertList.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="ponto">Ponto</TabsTrigger>
        </TabsList>

        {/* ---- Colaboradores ---- */}
        <TabsContent value="employees" className="space-y-4">
          {canEmployees && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setDialog("employee")}>
                <UserPlus className="mr-2 h-4 w-4" /> Colaborador
              </Button>
            </div>
          )}
          {empList.length === 0 ? (
            <EmptyState title="Nenhum colaborador" description="Cadastre a equipe para controlar férias e alertas." />
          ) : (
            <div className="space-y-2">
              {empList.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {e.fullName} <span className="font-mono text-xs text-muted-foreground">· {e.registration}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[e.role, e.sector].filter(Boolean).join(" · ") || "—"} · admissão {fmt(e.admittedAt)}
                    </p>
                  </div>
                  {e.openPeriod ? (
                    <span className="text-xs text-muted-foreground">
                      {e.openPeriod.daysRemaining} dia(s) até {fmt(e.openPeriod.concessionLimit)}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-600">sem período aquisitivo</span>
                  )}
                  <Badge variant="secondary">{EMP_STATUS[e.status] ?? e.status}</Badge>
                  {canVacations && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPeriodEmployeeId(e.id);
                        setDialog("period");
                      }}
                    >
                      <CalendarClock className="mr-2 h-4 w-4" /> Período
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Férias ---- */}
        <TabsContent value="vacations" className="space-y-4">
          {canVacations && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setDialog("request")}>
                <Plus className="mr-2 h-4 w-4" /> Solicitar férias
              </Button>
            </div>
          )}
          {vacList.length === 0 ? (
            <EmptyState title="Nenhuma solicitação" />
          ) : (
            <div className="space-y-2">
              {vacList.map((v) => {
                const st = REQ_STATUS[v.status] ?? { label: v.status, variant: "outline" as const };
                return (
                  <div key={v.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{v.employee?.fullName ?? "—"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {fmt(v.startDate)} – {fmt(v.endDate)} · {v.days} dia(s)
                        {v.sellDays ? ` + ${v.sellDays} de abono` : ""}
                        {v.employee?.sector ? ` · ${v.employee.sector}` : ""}
                      </p>
                    </div>
                    <Badge variant={st.variant}>{st.label}</Badge>
                    {v.status === "REQUESTED" && canApprove && (
                      <>
                        <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id: v.id, action: "approve" })}>
                          Aprovar
                        </Button>
                        <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ id: v.id, action: "reject" })}>
                          Recusar
                        </Button>
                      </>
                    )}
                    {(v.status === "APPROVED" || v.status === "SCHEDULED") && canVacations && (
                      <>
                        <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id: v.id, action: "mark_taken" })}>
                          Marcar usufruída
                        </Button>
                        <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ id: v.id, action: "cancel" })}>
                          Cancelar
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ---- Alertas ---- */}
        <TabsContent value="alerts" className="space-y-2">
          {alerts.isLoading ? (
            <PageSkeleton />
          ) : alertList.length === 0 ? (
            <EmptyState title="Sem alertas" description="Nenhum período concessivo próximo do limite." />
          ) : (
            alertList.map((a, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                  a.severity === "HIGH" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"
                }`}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p>{a.message}</p>
                  {a.dueAt && <p className="text-xs opacity-70">Referência: {fmt(a.dueAt)}</p>}
                </div>
              </div>
            ))
          )}
        </TabsContent>

        {/* ---- Ponto eletrônico ---- */}
        <TabsContent value="ponto" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>Colaborador</Label>
              <Select value={pontoEmp || "NONE"} onValueChange={(v) => setPontoEmp(v === "NONE" ? "" : v)}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Selecione</SelectItem>
                  {empList.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.registration})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mês</Label>
              <Input type="month" className="w-40" value={pontoMonth} onChange={(e) => setPontoMonth(e.target.value)} />
            </div>
            {canTimeclock && (
              <>
                <input
                  ref={pontoFileRef}
                  type="file"
                  accept=".csv,.txt,.afd,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importPonto.mutate(f);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" disabled={importPonto.isPending} onClick={() => pontoFileRef.current?.click()}>
                  {importPonto.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Importar arquivo do aparelho
                </Button>
                <Button variant="ghost" disabled={!pontoEmp} onClick={() => setDialog("manualPunch")}>
                  <Plus className="mr-2 h-4 w-4" /> Marcação manual
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Aparelho de referência: KNUP KP-1028 (exporta por pendrive). Layout aceito: <code>matrícula; data; hora</code> em CSV/TXT.
          </p>

          {!pontoEmp ? (
            <EmptyState title="Selecione um colaborador" description="Escolha quem e o mês para ver o espelho de ponto." />
          ) : mirror.isLoading ? (
            <PageSkeleton />
          ) : mirror.data ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat label="Trabalhado" value={hhmm(mirror.data.data.totalWorked)} />
                <MiniStat label="Previsto" value={hhmm(mirror.data.data.totalExpected)} />
                <MiniStat label="Saldo" value={hhmm(mirror.data.data.balance)} tone={mirror.data.data.balance >= 0 ? "pos" : "neg"} />
                <MiniStat label="Faltas" value={String(mirror.data.data.faltas)} tone={mirror.data.data.faltas ? "neg" : undefined} />
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2 text-left">Dia</th>
                      <th className="px-3 py-2 text-left">Marcações</th>
                      <th className="px-3 py-2 text-right">Trabalhado</th>
                      <th className="px-3 py-2 text-right">Previsto</th>
                      <th className="px-3 py-2 text-right">Saldo</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mirror.data.data.days.map((d) => (
                      <tr key={d.date} className="border-b border-border last:border-0">
                        <td className="whitespace-nowrap px-3 py-2">{new Date(d.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", weekday: "short" })}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{d.punches.map((p) => p.time).join("  ") || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{d.workedMinutes ? hhmm(d.workedMinutes) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{d.expectedMinutes ? hhmm(d.expectedMinutes) : "—"}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${d.balanceMinutes < 0 ? "text-destructive" : d.balanceMinutes > 0 ? "text-success" : ""}`}>
                          {d.status === "FOLGA" ? "—" : hhmm(d.balanceMinutes)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={DAY_STATUS[d.status].variant}>{DAY_STATUS[d.status].label}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <EmptyState title="Sem marcações no mês" />
          )}
        </TabsContent>
      </Tabs>

      {/* ---- Dialogs ---- */}
      <Dialog open={dialog === "employee"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo colaborador</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome completo" className="sm:col-span-2">
              <Input value={empForm.fullName} onChange={(e) => setEmpForm({ ...empForm, fullName: e.target.value })} />
            </Field>
            <Field label="Cargo">
              <Input value={empForm.role} onChange={(e) => setEmpForm({ ...empForm, role: e.target.value })} />
            </Field>
            <Field label="Setor">
              <Input value={empForm.sector} onChange={(e) => setEmpForm({ ...empForm, sector: e.target.value })} />
            </Field>
            <Field label="Admissão">
              <Input type="date" value={empForm.admittedAt} onChange={(e) => setEmpForm({ ...empForm, admittedAt: e.target.value })} />
            </Field>
            <Field label="Jornada semanal (h)">
              <Input type="number" value={empForm.weeklyHours} onChange={(e) => setEmpForm({ ...empForm, weeklyHours: e.target.value })} />
            </Field>
            <Field label="Vincular usuário (opcional)" className="sm:col-span-2">
              <Select value={empForm.userId || "NONE"} onValueChange={(v) => setEmpForm({ ...empForm, userId: v === "NONE" ? "" : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Nenhum</SelectItem>
                  {users.data?.data.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancelar
            </Button>
            <Button
              disabled={createEmployee.isPending || empForm.fullName.trim().length < 2 || !empForm.admittedAt}
              onClick={() => createEmployee.mutate()}
            >
              {createEmployee.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "period"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Período aquisitivo</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Início do período aquisitivo">
              <Input type="date" value={periodForm.accrualStart} onChange={(e) => setPeriodForm({ ...periodForm, accrualStart: e.target.value })} />
            </Field>
            <Field label="Fim do período aquisitivo">
              <Input type="date" value={periodForm.accrualEnd} onChange={(e) => setPeriodForm({ ...periodForm, accrualEnd: e.target.value })} />
            </Field>
            <Field label="Dias de direito">
              <Input type="number" value={periodForm.daysEntitled} onChange={(e) => setPeriodForm({ ...periodForm, daysEntitled: e.target.value })} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">O limite do período concessivo é calculado como 12 meses após o fim do aquisitivo.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancelar
            </Button>
            <Button
              disabled={createPeriod.isPending || !periodForm.accrualStart || !periodForm.accrualEnd}
              onClick={() => createPeriod.mutate()}
            >
              {createPeriod.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "request"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar férias</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Colaborador">
              <Select value={reqForm.employeeId || "NONE"} onValueChange={(v) => setReqForm({ ...reqForm, employeeId: v === "NONE" ? "" : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Selecione</SelectItem>
                  {empList
                    .filter((e) => e.status !== "TERMINATED")
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.fullName} ({e.registration})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Início">
                <Input type="date" value={reqForm.startDate} onChange={(e) => setReqForm({ ...reqForm, startDate: e.target.value })} />
              </Field>
              <Field label="Fim">
                <Input type="date" value={reqForm.endDate} onChange={(e) => setReqForm({ ...reqForm, endDate: e.target.value })} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Dias de abono (venda)">
                <Input type="number" min={0} max={10} value={reqForm.sellDays} onChange={(e) => setReqForm({ ...reqForm, sellDays: e.target.value })} />
              </Field>
              <div className="flex items-end text-sm text-muted-foreground">
                {reqDays > 0 ? `${reqDays} dia(s) de férias` : "informe as datas"}
              </div>
            </div>
            <Field label="Observação">
              <Textarea rows={3} value={reqForm.note} onChange={(e) => setReqForm({ ...reqForm, note: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancelar
            </Button>
            <Button
              disabled={createRequest.isPending || !reqForm.employeeId || reqDays <= 0}
              onClick={() => createRequest.mutate()}
            >
              {createRequest.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "manualPunch"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcação manual de ponto</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Data e hora" className="sm:col-span-2">
              <Input type="datetime-local" value={punch.timestamp} onChange={(e) => setPunch({ ...punch, timestamp: e.target.value })} />
            </Field>
            <Field label="Tipo">
              <Select value={punch.kind} onValueChange={(v) => setPunch({ ...punch, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">Entrada</SelectItem>
                  <SelectItem value="BREAK_OUT">Saída intervalo</SelectItem>
                  <SelectItem value="BREAK_IN">Volta intervalo</SelectItem>
                  <SelectItem value="OUT">Saída</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button disabled={addPunch.isPending || !punch.timestamp} onClick={() => addPunch.mutate()}>
              {addPunch.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone === "neg" ? "text-destructive" : tone === "pos" ? "text-success" : ""}`}>{value}</p>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
