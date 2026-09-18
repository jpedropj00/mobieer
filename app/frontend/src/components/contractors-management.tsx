import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, KeyRound, Loader2, Plus, ShieldOff, Trash2, Trophy, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import type { Contractor } from "@/types";
import type { InstallationTask } from "@/pages/contractor-area";
import { hm } from "@/pages/contractor-area";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");

// ============================ Acesso ============================

export function AccessDialog({ contractor, open, onOpenChange }: { contractor: Contractor | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<{ email: string; temporaryPassword: string | null } | null>(null);

  const grant = useMutation({
    mutationFn: () =>
      apiPost<{ data: { email: string; temporaryPassword: string | null } }>(`/installations/contractors/${contractor!.id}/access`, {
        email,
        password: password || undefined,
      }),
    onSuccess: (r) => {
      setResult(r.data);
      qc.invalidateQueries({ queryKey: ["contractors"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível liberar o acesso")),
  });
  const revoke = useMutation({
    mutationFn: () => apiDelete(`/installations/contractors/${contractor!.id}/access`),
    onSuccess: () => {
      toast.success("Acesso bloqueado");
      qc.invalidateQueries({ queryKey: ["contractors"] });
      close();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível bloquear")),
  });

  const close = () => {
    setEmail("");
    setPassword("");
    setResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Acesso ao sistema — {contractor?.name}</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 text-primary" /> Acesso liberado
            </p>
            <div className="space-y-1 rounded-md bg-muted/50 p-3">
              <p>
                Login: <strong>{result.email}</strong>
              </p>
              {result.temporaryPassword ? (
                <p className="flex items-center gap-2">
                  Senha provisória: <strong className="font-mono">{result.temporaryPassword}</strong>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => navigator.clipboard.writeText(`Login: ${result.email}\nSenha: ${result.temporaryPassword}`).then(() => toast.success("Copiado"))}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </p>
              ) : (
                <p>Senha: a que você definiu.</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Esta senha não aparece de novo. Repasse ao montador — ele pode trocá-la em Configurações → Minha conta.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              O montador entra no mesmo endereço do sistema e vê só a área dele: ponto, cômodos, produtividade e o chat com a equipe.
              {contractor?.hasAccess ? " Ele já tem acesso — preencher abaixo troca e-mail e senha." : ""}
            </p>
            <div className="space-y-2">
              <Label>E-mail de login</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Senha (opcional)</Label>
              <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="vazio = gerar senha provisória" />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          {result ? (
            <Button onClick={close}>Fechar</Button>
          ) : (
            <>
              {contractor?.hasAccess && (
                <Button variant="ghost" className="mr-auto text-destructive" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
                  <ShieldOff className="mr-2 h-4 w-4" /> Bloquear acesso
                </Button>
              )}
              <Button variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button disabled={!/\S+@\S+\.\S+/.test(email) || (password.length > 0 && password.length < 8) || grant.isPending} onClick={() => grant.mutate()}>
                {grant.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                {contractor?.hasAccess ? "Atualizar acesso" : "Liberar acesso"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================ Cômodos ============================

type Project = { id: string; name: string; code?: string };

export function InstallationsTab({ contractors, projects, canManage }: { contractors: Contractor[]; projects: Project[]; canManage: boolean }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"PENDING_REVIEW" | "OPEN" | "ALL">("PENDING_REVIEW");
  const params = filter === "PENDING_REVIEW" ? { status: "DONE", review: "PENDING" } : filter === "OPEN" ? {} : {};
  const tasks = useQuery({
    queryKey: ["installations", filter],
    queryFn: () => apiGet<{ data: InstallationTask[] }>("/installations", params),
  });
  const roomTypes = useQuery({ queryKey: ["installations", "room-types"], queryFn: () => apiGet<{ data: { key: string; label: string }[] }>("/installations/room-types") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["installations"] });

  const [assignOpen, setAssignOpen] = useState(false);
  const [assign, setAssign] = useState({ contractorId: "", projectId: "", roomType: "", roomLabel: "" });
  const [reviewing, setReviewing] = useState<{ task: InstallationTask; decision: "APPROVED" | "REJECTED" } | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [minutesEdit, setMinutesEdit] = useState("");

  const create = useMutation({
    mutationFn: () => apiPost("/installations", { ...assign, roomLabel: assign.roomLabel || null }),
    onSuccess: () => {
      toast.success("Cômodo atribuído");
      setAssignOpen(false);
      setAssign({ contractorId: "", projectId: "", roomType: "", roomLabel: "" });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível atribuir")),
  });

  const review = useMutation({
    mutationFn: async () => {
      const t = reviewing!.task;
      const mins = minutesEdit.trim();
      if (mins && Number(mins) !== t.workedMinutes) await apiPatch(`/installations/${t.id}`, { workedMinutes: Number(mins) });
      return apiPost<{ message?: string }>(`/installations/${t.id}/review`, { decision: reviewing!.decision, notes: reviewNotes || null });
    },
    onSuccess: (r) => {
      toast.success(r.message ?? "Validado");
      setReviewing(null);
      setReviewNotes("");
      setMinutesEdit("");
      refresh();
      qc.invalidateQueries({ queryKey: ["installations-productivity"] });
      qc.invalidateQueries({ queryKey: ["installations-bonuses"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível validar")),
  });

  const list = (tasks.data?.data ?? []).filter((t) => (filter === "OPEN" ? ["PENDING", "IN_PROGRESS", "PAUSED"].includes(t.status) : true));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(
            [
              ["PENDING_REVIEW", "Para validar"],
              ["OPEN", "Em andamento"],
              ["ALL", "Todos"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${filter === k ? "bg-background shadow-sm" : "text-muted-foreground"}`}
            >
              {l}
            </button>
          ))}
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setAssignOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Atribuir cômodo
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={filter === "PENDING_REVIEW" ? "Nada para validar" : "Nenhum cômodo"}
          description="Os cômodos são registrados pelo montador no celular ou atribuídos aqui."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Montador</TableHead>
                <TableHead>Cômodo</TableHead>
                <TableHead>Obra</TableHead>
                <TableHead className="text-right">Tempo</TableHead>
                <TableHead className="text-right">Meta própria</TableHead>
                <TableHead>Situação</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.contractor.name}</TableCell>
                  <TableCell>{t.roomLabel || t.roomTypeLabel}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.project.code} — {t.project.client.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{hm(t.liveMinutes)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.targetMinutes ? hm(t.targetMinutes) : <span className="text-xs text-muted-foreground">sem meta</span>}
                    {t.gainPct != null && (
                      <span className={`ml-1 text-xs ${t.gainPct > 0 ? "text-success" : "text-muted-foreground"}`}>
                        ({t.gainPct > 0 ? "−" : "+"}{Math.abs(t.gainPct).toLocaleString("pt-BR")}%)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {t.status !== "DONE" ? (
                      <Badge variant="muted">{t.status === "IN_PROGRESS" ? "Montando" : t.status === "PAUSED" ? "Pausado" : t.status === "CANCELLED" ? "Cancelado" : "Não iniciado"}</Badge>
                    ) : t.review === "PENDING" ? (
                      <Badge variant="warning">Validar</Badge>
                    ) : t.review === "APPROVED" ? (
                      <Badge variant="success">Aprovado{t.bonus ? ` · ${brl(t.bonus.amount)}` : ""}</Badge>
                    ) : (
                      <Badge variant="danger">Reprovado</Badge>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {t.status === "DONE" && t.review === "PENDING" && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => { setReviewing({ task: t, decision: "APPROVED" }); setMinutesEdit(String(t.workedMinutes)); }}>
                            <CheckCircle2 className="mr-1 h-4 w-4" /> Aprovar
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setReviewing({ task: t, decision: "REJECTED" }); setMinutesEdit(""); }}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atribuir cômodo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Picker label="Montador" value={assign.contractorId} onChange={(v) => setAssign({ ...assign, contractorId: v })} options={contractors.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))} />
            <Picker label="Obra / projeto" value={assign.projectId} onChange={(v) => setAssign({ ...assign, projectId: v })} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
            <Picker label="Tipo de cômodo" value={assign.roomType} onChange={(v) => setAssign({ ...assign, roomType: v })} options={(roomTypes.data?.data ?? []).map((r) => ({ value: r.key, label: r.label }))} />
            <div className="space-y-2">
              <Label>Nome (opcional)</Label>
              <Input value={assign.roomLabel} onChange={(e) => setAssign({ ...assign, roomLabel: e.target.value })} placeholder="Ex.: Cozinha — parede da pia" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancelar</Button>
            <Button disabled={!assign.contractorId || !assign.projectId || !assign.roomType || create.isPending} onClick={() => create.mutate()}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Atribuir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reviewing)} onOpenChange={(v) => !v && setReviewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewing?.decision === "APPROVED" ? "Aprovar montagem" : "Reprovar montagem"}</DialogTitle>
          </DialogHeader>
          {reviewing && (
            <div className="space-y-3 text-sm">
              <p>
                {reviewing.task.contractor.name} · {reviewing.task.roomLabel || reviewing.task.roomTypeLabel} · {reviewing.task.project.code}
              </p>
              {reviewing.decision === "APPROVED" && (
                <div className="space-y-2">
                  <Label>Tempo trabalhado (minutos)</Label>
                  <Input type="number" min={0} value={minutesEdit} onChange={(e) => setMinutesEdit(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    Corrija se o cronômetro ficou ligado por engano. Meta própria: {reviewing.task.targetMinutes ? hm(reviewing.task.targetMinutes) : "ainda sem meta"}.
                    O bônus é calculado na aprovação.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>{reviewing.decision === "REJECTED" ? "O que precisa de ajuste? *" : "Observação (opcional)"}</Label>
                <Textarea rows={3} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)}>Cancelar</Button>
            <Button
              variant={reviewing?.decision === "REJECTED" ? "destructive" : "default"}
              disabled={review.isPending || (reviewing?.decision === "REJECTED" && !reviewNotes.trim())}
              onClick={() => review.mutate()}
            >
              {review.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {reviewing?.decision === "APPROVED" ? "Aprovar" : "Reprovar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Picker({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================ Produtividade ============================

type Report = {
  pendingReview: number;
  contractors: {
    contractorId: string;
    name: string;
    rooms: number;
    hours: number;
    avgGainPct: number | null;
    roomsAboveTarget: number;
    bonusTotal: number;
    byRoom: { roomType: string; label: string; count: number; medianMinutes: number; bestMinutes: number; teamMedianMinutes: number; avgGainPct: number | null }[];
  }[];
  team: { roomType: string; label: string; count: number; medianMinutes: number; p80Minutes: number }[];
};

export function ProductivityTab({ range }: { range: { from: string; to: string } }) {
  const q = useQuery({
    queryKey: ["installations-productivity", range],
    queryFn: () => apiGet<{ data: Report }>("/installations/productivity", range),
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const r = q.data?.data;
  if (!r) return <p className="text-sm text-destructive">{errorMessage(q.error, "Não foi possível carregar")}</p>;

  return (
    <div className="space-y-4">
      {r.pendingReview > 0 && (
        <p className="rounded-md bg-warning/10 p-2 text-xs">{r.pendingReview} cômodo(s) aguardando validação — só entram no relatório depois de aprovados.</p>
      )}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Tempo típico da equipe por cômodo</CardTitle>
          <p className="text-xs text-muted-foreground">Referência para a gestão. A meta de bônus de cada montador é o próprio ritmo dele.</p>
        </CardHeader>
        <CardContent>
          {r.team.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Sem cômodos aprovados no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cômodo</TableHead>
                    <TableHead className="text-right">Montados</TableHead>
                    <TableHead className="text-right">Tempo típico</TableHead>
                    <TableHead className="text-right">8 em cada 10 até</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.team.map((t) => (
                    <TableRow key={t.roomType}>
                      <TableCell>{t.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{hm(t.medianMinutes)}</TableCell>
                      <TableCell className="text-right tabular-nums">{hm(t.p80Minutes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {r.contractors.map((c) => (
        <Card key={c.contractorId}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>{c.name}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {c.rooms} cômodo(s) · {c.hours.toLocaleString("pt-BR")}h · {c.roomsAboveTarget} acima da meta · bônus {brl(c.bonusTotal)}
                {c.avgGainPct != null && ` · ganho médio ${c.avgGainPct.toLocaleString("pt-BR")}%`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cômodo</TableHead>
                  <TableHead className="text-right">Qtd.</TableHead>
                  <TableHead className="text-right">Tempo típico dele</TableHead>
                  <TableHead className="text-right">Melhor</TableHead>
                  <TableHead className="text-right">Equipe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.byRoom.map((b) => (
                  <TableRow key={b.roomType}>
                    <TableCell>{b.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{hm(b.medianMinutes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hm(b.bestMinutes)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{hm(b.teamMedianMinutes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================ Bonificação ============================

type Policy = { enabled: boolean; minSamples: number; tiers: { minGainPct: number; amount: number }[]; maxPerMonth: number | null; configured: boolean };
type BonusRow = {
  id: string;
  contractor: { id: string; name: string };
  roomTypeLabel: string;
  roomLabel: string | null;
  project: { code: string; name: string };
  targetMinutes: number;
  actualMinutes: number;
  gainPct: number;
  amount: number;
  status: "APPROVED" | "PAID" | "CANCELLED";
  paidAt: string | null;
  createdAt: string;
};

export function BonusTab({ canManage, range }: { canManage: boolean; range: { from: string; to: string } }) {
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ["installations", "bonus-policy"], queryFn: () => apiGet<{ data: Policy }>("/installations/bonus-policy") });
  const bonuses = useQuery({ queryKey: ["installations-bonuses", range], queryFn: () => apiGet<{ data: BonusRow[] }>("/installations/bonuses", range) });
  const [draft, setDraft] = useState<Policy | null>(null);
  const p = draft ?? policy.data?.data ?? null;

  const save = useMutation({
    mutationFn: () => apiPut("/installations/bonus-policy", { enabled: p!.enabled, minSamples: p!.minSamples, tiers: p!.tiers, maxPerMonth: p!.maxPerMonth }),
    onSuccess: () => {
      toast.success("Regra salva");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["installations", "bonus-policy"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar a regra")),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pay" | "cancel" }) => apiPost(`/installations/bonuses/${id}/${action}`),
    onSuccess: () => {
      toast.success("Atualizado");
      qc.invalidateQueries({ queryKey: ["installations-bonuses"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível atualizar")),
  });

  const edit = (patch: Partial<Policy>) => p && setDraft({ ...p, ...patch });
  const rows = bonuses.data?.data ?? [];
  const toPay = rows.filter((b) => b.status === "APPROVED").reduce((a, b) => a + b.amount, 0);

  return (
    <div className="space-y-4">
      {p && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-primary" /> Regra de bonificação
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Cada montador tem uma meta própria por tipo de cômodo: o tempo típico dele mesmo (mediana dos últimos cômodos aprovados). Quando a gestão aprova um cômodo montado mais rápido que essa meta, o bônus da faixa atingida é lançado.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Switch id="bonus-on" checked={p.enabled} disabled={!canManage} onCheckedChange={(v) => edit({ enabled: v })} />
              <Label htmlFor="bonus-on">{p.enabled ? "Bonificação ligada" : "Bonificação desligada"}</Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Cômodos do mesmo tipo antes de existir meta</Label>
                <Input type="number" min={1} max={10} disabled={!canManage} value={p.minSamples} onChange={(e) => edit({ minSamples: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Teto de bônus por montador no mês (R$)</Label>
                <Input
                  inputMode="decimal"
                  disabled={!canManage}
                  placeholder="sem teto"
                  value={p.maxPerMonth ?? ""}
                  onChange={(e) => edit({ maxPerMonth: e.target.value.trim() === "" ? null : Number(e.target.value.replace(",", ".")) })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Faixas</Label>
              {p.tiers.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span>Mais rápido que a meta em pelo menos</span>
                  <Input
                    className="w-20"
                    type="number"
                    min={1}
                    max={99}
                    disabled={!canManage}
                    value={t.minGainPct}
                    onChange={(e) => edit({ tiers: p.tiers.map((x, j) => (j === i ? { ...x, minGainPct: Number(e.target.value) } : x)) })}
                  />
                  <span>% → bônus de R$</span>
                  <Input
                    className="w-24"
                    inputMode="decimal"
                    disabled={!canManage}
                    value={t.amount}
                    onChange={(e) => edit({ tiers: p.tiers.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value.replace(",", ".")) } : x)) })}
                  />
                  {canManage && p.tiers.length > 1 && (
                    <Button size="icon" variant="ghost" onClick={() => edit({ tiers: p.tiers.filter((_, j) => j !== i) })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {canManage && p.tiers.length < 6 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const last = p.tiers[p.tiers.length - 1];
                    edit({ tiers: [...p.tiers, { minGainPct: Math.min(95, (last?.minGainPct ?? 0) + 10), amount: (last?.amount ?? 0) + 30 }] });
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" /> Faixa
                </Button>
              )}
            </div>
            {!p.configured && !draft && <p className="text-xs text-muted-foreground">Valores sugeridos — revise e salve para usar.</p>}
            {canManage && (
              <div className="flex gap-2">
                <Button disabled={save.isPending || (!draft && p.configured)} onClick={() => save.mutate()}>
                  {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar regra
                </Button>
                {draft && (
                  <Button variant="ghost" onClick={() => setDraft(null)}>
                    Descartar
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">Bônus lançados</CardTitle>
          <span className="text-sm text-muted-foreground">A pagar: <strong className="text-foreground">{brl(toPay)}</strong></span>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nenhum bônus no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Montador</TableHead>
                    <TableHead>Cômodo</TableHead>
                    <TableHead className="text-right">Meta → real</TableHead>
                    <TableHead className="text-right">Bônus</TableHead>
                    <TableHead>Situação</TableHead>
                    {canManage && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="text-xs">{fmtDate(b.createdAt)}</TableCell>
                      <TableCell className="font-medium">{b.contractor.name}</TableCell>
                      <TableCell className="text-xs">{b.roomLabel || b.roomTypeLabel} · {b.project.code}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {hm(b.targetMinutes)} → {hm(b.actualMinutes)} ({b.gainPct.toLocaleString("pt-BR")}%)
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{brl(b.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={b.status === "PAID" ? "success" : b.status === "CANCELLED" ? "muted" : "warning"}>
                          {b.status === "PAID" ? `Pago ${fmtDate(b.paidAt)}` : b.status === "CANCELLED" ? "Cancelado" : "A pagar"}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          {b.status === "APPROVED" && (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id: b.id, action: "pay" })}>
                                Marcar pago
                              </Button>
                              <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => { if (confirm("Cancelar este bônus?")) act.mutate({ id: b.id, action: "cancel" }); }}>
                                Cancelar
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
