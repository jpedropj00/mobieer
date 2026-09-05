import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Plus, Target, TrendingUp, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
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
import { apiGet, apiPatch, apiPost } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { errorMessage, formatCurrency } from "@/lib/utils";
import type { CommercialLead, Opportunity, PipelineSummary, SalesStage } from "@/types";

const LEAD_STATUS: Record<string, string> = {
  NEW: "Novo", CONTACTED: "Contatado", QUALIFIED: "Qualificado", CONVERTED: "Convertido", LOST: "Perdido",
};
const INTERACTION_TYPES = [
  ["CALL", "Ligação"], ["WHATSAPP", "WhatsApp"], ["EMAIL", "E-mail"], ["MEETING", "Reunião"], ["VISIT", "Visita"], ["OTHER", "Outro"],
] as const;
const LEAD_SOURCES = ["Instagram", "Indicação", "Google", "Site", "Arquiteto", "Parceiros", "Outro"];
const LOST_REASONS = [
  ["PRECO", "Preço"], ["PRAZO", "Prazo"], ["CONCORRENCIA", "Concorrência"], ["SEM_RESPOSTA", "Sem resposta"],
  ["DESISTIU", "Desistiu"], ["ESCOPO", "Escopo"], ["OUTRO", "Outro"],
] as const;

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const scoreColor = (s: number) => (s >= 70 ? "text-success" : s >= 40 ? "text-warning" : "text-muted-foreground");

export function CommercialPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("commercial.manage");
  const canLeads = can("commercial.leads.manage");

  const stages = useQuery({ queryKey: ["commercial", "stages"], queryFn: () => apiGet<{ data: SalesStage[] }>("/commercial/stages") });
  const opps = useQuery({ queryKey: ["commercial", "opportunities"], queryFn: () => apiGet<{ data: Opportunity[] }>("/commercial/opportunities") });
  const leads = useQuery({ queryKey: ["commercial", "leads"], queryFn: () => apiGet<{ data: CommercialLead[] }>("/commercial/leads") });
  const pipeline = useQuery({ queryKey: ["commercial", "pipeline"], queryFn: () => apiGet<{ data: PipelineSummary }>("/commercial/pipeline") });

  const refresh = () => qc.invalidateQueries({ queryKey: ["commercial"] });

  const [dialog, setDialog] = useState<null | "opp" | "lead" | "convert" | "interaction" | "move" | "briefing" | "lose">(null);
  const [active, setActive] = useState<Opportunity | null>(null);
  const [convertLead, setConvertLead] = useState<CommercialLead | null>(null);
  const [briefLead, setBriefLead] = useState<string | null>(null);
  const [loseForm, setLoseForm] = useState({ code: "SEM_RESPOSTA", note: "" });

  const [oppForm, setOppForm] = useState({ title: "", stageId: "", estimatedValue: "", expectedCloseAt: "", nextAction: "" });
  const [leadForm, setLeadForm] = useState({ name: "", phone: "", email: "", source: "", interest: "" });
  const [convForm, setConvForm] = useState({ title: "", estimatedValue: "", stageId: "" });
  const [intForm, setIntForm] = useState({ type: "CALL", summary: "", result: "", nextAction: "", nextActionAt: "" });
  const [moveStage, setMoveStage] = useState("");

  const openStages = useMemo(() => (stages.data?.data ?? []).filter((s) => !s.isWon && !s.isLost && s.active), [stages.data]);

  const createOpp = useMutation({
    mutationFn: () => apiPost("/commercial/opportunities", { ...oppForm, estimatedValue: Number(oppForm.estimatedValue || 0), expectedCloseAt: oppForm.expectedCloseAt || null, nextAction: oppForm.nextAction || null }),
    onSuccess: () => { toast.success("Oportunidade criada"); setDialog(null); setOppForm({ title: "", stageId: "", estimatedValue: "", expectedCloseAt: "", nextAction: "" }); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao criar")),
  });
  const createLead = useMutation({
    mutationFn: () => apiPost("/commercial/leads", { ...leadForm, email: leadForm.email || null }),
    onSuccess: () => { toast.success("Lead criado"); setDialog(null); setLeadForm({ name: "", phone: "", email: "", source: "", interest: "" }); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao criar")),
  });
  const doConvert = useMutation({
    mutationFn: () => apiPost(`/commercial/leads/${convertLead!.id}/convert`, { title: convForm.title || undefined, estimatedValue: Number(convForm.estimatedValue || 0), stageId: convForm.stageId || undefined }),
    onSuccess: () => { toast.success("Lead convertido em oportunidade"); setDialog(null); setConvertLead(null); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao converter")),
  });
  const logInteraction = useMutation({
    mutationFn: () => apiPost(`/commercial/opportunities/${active!.id}/interactions`, { ...intForm, result: intForm.result || null, nextAction: intForm.nextAction || null, nextActionAt: intForm.nextActionAt || null }),
    onSuccess: () => { toast.success("Interação registrada"); setDialog(null); setIntForm({ type: "CALL", summary: "", result: "", nextAction: "", nextActionAt: "" }); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao registrar")),
  });
  const patchOpp = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch(`/commercial/opportunities/${active!.id}`, body),
    onSuccess: () => { toast.success("Atualizado"); setDialog(null); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao atualizar")),
  });

  if (stages.isLoading || opps.isLoading) return <PageSkeleton />;

  const oppList = opps.data?.data ?? [];
  const leadList = leads.data?.data ?? [];
  const p = pipeline.data?.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Comercial" description="Funil de vendas, leads e previsão." >
        {canManage && (
          <Button size="sm" onClick={() => setDialog("opp")}>
            <Plus className="mr-2 h-4 w-4" /> Oportunidade
          </Button>
        )}
      </PageHeader>

      {p && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard title="Oportunidades abertas" value={p.openCount} icon={Target} />
          <KpiCard title="Valor em aberto" value={formatCurrency(p.openValue)} icon={TrendingUp} />
          <KpiCard title="Previsão ponderada" value={formatCurrency(p.forecast)} icon={TrendingUp} iconBg="bg-success/10" />
          <KpiCard title="Taxa de conversão" value={`${p.winRate}%`} icon={Target} />
        </div>
      )}

      <Tabs defaultValue="funil">
        <TabsList>
          <TabsTrigger value="funil">Funil ({oppList.length})</TabsTrigger>
          <TabsTrigger value="leads">Leads ({leadList.filter((l) => l.status !== "CONVERTED").length})</TabsTrigger>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
        </TabsList>

        {/* ---- Funil (kanban) ---- */}
        <TabsContent value="funil">
          {openStages.length === 0 ? (
            <EmptyState title="Nenhuma etapa de funil" description="Cadastre as etapas em Configurações do comercial." />
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {openStages.map((s) => {
                const items = oppList.filter((o) => o.stage.id === s.id);
                const sum = items.reduce((a, o) => a + o.estimatedValue, 0);
                return (
                  <div key={s.id} className="w-72 shrink-0">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="text-sm font-semibold">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{items.length} · {formatCurrency(sum)}</span>
                    </div>
                    <div className="space-y-2">
                      {items.map((o) => (
                        <button
                          key={o.id}
                          onClick={() => { setActive(o); setMoveStage(o.stage.id); setDialog("move"); }}
                          className="w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium leading-snug">{o.title}</p>
                            <span className={`shrink-0 text-xs font-bold ${scoreColor(o.score)}`}>{o.score}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{o.client?.name ?? "Sem cliente"}</p>
                          <div className="mt-2 flex items-center justify-between text-xs">
                            <span className="font-semibold">{formatCurrency(o.estimatedValue)}</span>
                            <span className="text-muted-foreground">{o.probability}%</span>
                          </div>
                          {o.nextAction && (
                            <p className="mt-1 truncate text-xs text-primary">▸ {o.nextAction} {o.nextActionAt ? `(${fmtDate(o.nextActionAt)})` : ""}</p>
                          )}
                        </button>
                      ))}
                      {items.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">—</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ---- Leads ---- */}
        <TabsContent value="leads" className="space-y-4">
          {canLeads && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setDialog("lead")}><UserPlus className="mr-2 h-4 w-4" /> Lead</Button>
            </div>
          )}
          {leadList.length === 0 ? (
            <EmptyState title="Nenhum lead" />
          ) : (
            <div className="space-y-2">
              {leadList.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {l.name}
                      {l.briefing && <Badge variant="secondary" className="ml-2 align-middle text-[10px]">briefing</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[l.phone, l.interest, l.source].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <Badge variant="secondary">{LEAD_STATUS[l.status] ?? l.status}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => { setBriefLead(l.id); setDialog("briefing"); }}>
                    {l.briefing ? "Ver briefing" : "Briefing"}
                  </Button>
                  {canLeads && l.status !== "CONVERTED" && l.status !== "LOST" && (
                    <Button size="sm" variant="outline" onClick={() => { setConvertLead(l); setConvForm({ title: l.interest ? `${l.name} — ${l.interest}` : l.name, estimatedValue: "", stageId: "" }); setDialog("convert"); }}>
                      Converter <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Resumo ---- */}
        <TabsContent value="resumo" className="space-y-4">
          {!p ? (
            <PageSkeleton />
          ) : (
            <Card>
              <CardHeader><CardTitle className="text-base">Valor por etapa</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {p.byStage.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                    <span>{s.name} <span className="text-xs text-muted-foreground">({s.count})</span></span>
                    <span className="tabular-nums">
                      {formatCurrency(s.total)}
                      <span className="ml-2 text-xs text-muted-foreground">ponderado {formatCurrency(s.weighted)}</span>
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 text-sm font-semibold">
                  <span>Previsão total ponderada</span>
                  <span className="tabular-nums text-success">{formatCurrency(p.forecast)}</span>
                </div>
                <div className="flex flex-wrap gap-6 pt-1 text-xs text-muted-foreground">
                  <span>Ganhos: {p.wonCount} · {formatCurrency(p.wonValue)}</span>
                  <span>Perdidos: {p.lostCount}</span>
                  <span>Ticket médio: {formatCurrency(p.ticketMedio)}</span>
                </div>
                {p.lostReasons.length > 0 && (
                  <div className="pt-3">
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">Motivos de perda</p>
                    {p.lostReasons.map((r) => (
                      <div key={r.code} className="flex items-center justify-between border-b border-border py-1.5 text-sm last:border-0">
                        <span>{r.label}</span>
                        <span className="tabular-nums text-muted-foreground">{r.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ============ Dialogs ============ */}
      <Dialog open={dialog === "opp"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova oportunidade</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Título"><Input value={oppForm.title} onChange={(e) => setOppForm({ ...oppForm, title: e.target.value })} /></Field>
            <Field label="Etapa">
              <Select value={oppForm.stageId || "NONE"} onValueChange={(v) => setOppForm({ ...oppForm, stageId: v === "NONE" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent><SelectItem value="NONE">Selecione</SelectItem>{openStages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Valor estimado (R$)"><Input type="number" value={oppForm.estimatedValue} onChange={(e) => setOppForm({ ...oppForm, estimatedValue: e.target.value })} /></Field>
              <Field label="Previsão de fechamento"><Input type="date" value={oppForm.expectedCloseAt} onChange={(e) => setOppForm({ ...oppForm, expectedCloseAt: e.target.value })} /></Field>
            </div>
            <Field label="Próxima ação"><Input value={oppForm.nextAction} onChange={(e) => setOppForm({ ...oppForm, nextAction: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button disabled={createOpp.isPending || oppForm.title.length < 2 || !oppForm.stageId} onClick={() => createOpp.mutate()}>
              {createOpp.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "lead"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo lead</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" className="sm:col-span-2"><Input value={leadForm.name} onChange={(e) => setLeadForm({ ...leadForm, name: e.target.value })} /></Field>
            <Field label="Telefone"><Input value={leadForm.phone} onChange={(e) => setLeadForm({ ...leadForm, phone: e.target.value })} /></Field>
            <Field label="E-mail"><Input type="email" value={leadForm.email} onChange={(e) => setLeadForm({ ...leadForm, email: e.target.value })} /></Field>
            <Field label="Origem">
              <Select value={leadForm.source || "NONE"} onValueChange={(v) => setLeadForm({ ...leadForm, source: v === "NONE" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent><SelectItem value="NONE">—</SelectItem>{LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Interesse"><Input value={leadForm.interest} onChange={(e) => setLeadForm({ ...leadForm, interest: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button disabled={createLead.isPending || leadForm.name.length < 2} onClick={() => createLead.mutate()}>
              {createLead.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "convert"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Converter lead — {convertLead?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Cria um cliente e uma oportunidade na primeira etapa do funil.</p>
            <Field label="Título da oportunidade"><Input value={convForm.title} onChange={(e) => setConvForm({ ...convForm, title: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Valor estimado (R$)"><Input type="number" value={convForm.estimatedValue} onChange={(e) => setConvForm({ ...convForm, estimatedValue: e.target.value })} /></Field>
              <Field label="Etapa">
                <Select value={convForm.stageId || "AUTO"} onValueChange={(v) => setConvForm({ ...convForm, stageId: v === "AUTO" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="AUTO">1ª etapa (auto)</SelectItem>{openStages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button disabled={doConvert.isPending} onClick={() => doConvert.mutate()}>
              {doConvert.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Converter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* mover etapa / ações da oportunidade */}
      <Dialog open={dialog === "move"} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{active?.title}</DialogTitle></DialogHeader>
          {active && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div><p className="text-xs text-muted-foreground">Valor</p><p className="font-semibold">{formatCurrency(active.estimatedValue)}</p></div>
                <div><p className="text-xs text-muted-foreground">Prob.</p><p className="font-semibold">{active.probability}%</p></div>
                <div><p className="text-xs text-muted-foreground">Score</p><p className={`font-semibold ${scoreColor(active.score)}`}>{active.score}</p></div>
              </div>
              {active.lastInteractionAt && <p className="text-xs text-muted-foreground">Último contato: {fmtDate(active.lastInteractionAt)} · {active.interactionCount} interação(ões)</p>}

              {canManage && (
                <>
                  <Field label="Mover para etapa">
                    <Select value={moveStage} onValueChange={setMoveStage}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{(stages.data?.data ?? []).filter((s) => s.active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={patchOpp.isPending || moveStage === active.stage.id} onClick={() => patchOpp.mutate({ stageId: moveStage })}>Mover</Button>
                    <Button size="sm" variant="outline" onClick={() => setDialog("interaction")}>Registrar interação</Button>
                    <Button size="sm" variant="outline" className="text-success" onClick={() => patchOpp.mutate({ action: "win" })}>Marcar ganho</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setLoseForm({ code: "SEM_RESPOSTA", note: "" }); setDialog("lose"); }}>Marcar perdido</Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "interaction"} onOpenChange={(v) => !v && setDialog("move")}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar interação</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Tipo">
              <Select value={intForm.type} onValueChange={(v) => setIntForm({ ...intForm, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{INTERACTION_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Resumo"><Textarea rows={3} value={intForm.summary} onChange={(e) => setIntForm({ ...intForm, summary: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Próxima ação"><Input value={intForm.nextAction} onChange={(e) => setIntForm({ ...intForm, nextAction: e.target.value })} /></Field>
              <Field label="Quando"><Input type="date" value={intForm.nextActionAt} onChange={(e) => setIntForm({ ...intForm, nextActionAt: e.target.value })} /></Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog("move")}>Voltar</Button>
            <Button disabled={logInteraction.isPending || intForm.summary.length < 2} onClick={() => logInteraction.mutate()}>
              {logInteraction.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "lose"} onOpenChange={(v) => !v && setDialog("move")}>
        <DialogContent>
          <DialogHeader><DialogTitle>Marcar como perdida</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Motivo da perda">
              <Select value={loseForm.code} onValueChange={(v) => setLoseForm({ ...loseForm, code: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LOST_REASONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Detalhe (opcional)"><Textarea rows={2} value={loseForm.note} onChange={(e) => setLoseForm({ ...loseForm, note: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog("move")}>Voltar</Button>
            <Button variant="destructive" disabled={patchOpp.isPending} onClick={() => patchOpp.mutate({ action: "lose", lostReasonCode: loseForm.code, lostReason: loseForm.note || (LOST_REASONS.find(([v]) => v === loseForm.code)?.[1] ?? loseForm.code) })}>
              {patchOpp.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar perda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "briefing"} onOpenChange={(v) => { if (!v) { setDialog(null); setBriefLead(null); } }}>
        <DialogContent>
          {briefLead && <BriefingDialog leadId={briefLead} canEdit={canLeads} onSaved={() => { setDialog(null); setBriefLead(null); refresh(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ENV_LIST = ["Suíte Master", "Cozinha", "Sala", "Suíte Hóspede", "Suíte Filhos", "Banheiro", "Varanda", "Ambiente Corporativo", "Ambiente Comercial", "Área de Serviço", "Lavabo", "Outro"];
const CHANNELS = ["Instagram", "Indicação", "Google", "Site", "Arquiteto", "Parceiros", "Outro"];

function BriefingDialog({ leadId, canEdit, onSaved }: { leadId: string; canEdit: boolean; onSaved: () => void }) {
  const q = useQuery({ queryKey: ["commercial", "briefing", leadId], queryFn: () => apiGet<{ data: { lead: { name: string }; briefing: BriefingData | null } }>(`/commercial/leads/${leadId}/briefing`) });
  const [f, setF] = useState<BriefingForm>({ address: "", investmentText: "", hasProject: false, environments: [], userCount: "", discoveryChannel: "", notes: "" });
  const [editing, setEditing] = useState(false);

  const b = q.data?.data.briefing ?? null;
  useMemoInit(b, setF, setEditing);

  const save = useMutation({
    mutationFn: () => apiPost(`/commercial/leads/${leadId}/briefing`, {
      address: f.address || null,
      investmentText: f.investmentText || null,
      investmentEstimate: parseFloat(f.investmentText.replace(/[^\d.,-]/g, "").replace(",", ".")) || null,
      hasProject: f.hasProject,
      environments: f.environments,
      userCount: f.userCount ? Number(f.userCount) : null,
      discoveryChannel: f.discoveryChannel || null,
      notes: f.notes || null,
    }),
    onSuccess: () => { toast.success("Briefing salvo"); onSaved(); },
    onError: (e) => toast.error(errorMessage(e, "Falha ao salvar")),
  });

  if (q.isLoading) return <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>;

  const show = b && !editing;
  return (
    <>
      <DialogHeader><DialogTitle>Briefing — {q.data?.data.lead.name}</DialogTitle></DialogHeader>
      {show ? (
        <div className="space-y-2 text-sm">
          <Row k="Endereço" v={b!.address} />
          <Row k="Investimento" v={b!.investmentText ?? (b!.investmentEstimate ? formatCurrency(b!.investmentEstimate) : null)} />
          <Row k="Já tem projeto" v={b!.hasProject ? "Sim" : "Não"} />
          <Row k="Ambientes" v={b!.environments.join(", ")} />
          <Row k="Nº de pessoas" v={b!.userCount != null ? String(b!.userCount) : null} />
          <Row k="Como conheceu" v={b!.discoveryChannel} />
          <Row k="Observações" v={b!.notes} />
          <p className="pt-1 text-xs text-muted-foreground">Enviado em {new Date(b!.submittedAt).toLocaleDateString("pt-BR")} · {b!.origin === "PUBLIC" ? "formulário público" : "consultor"}</p>
          {canEdit && <DialogFooter><Button size="sm" variant="outline" onClick={() => setEditing(true)}>Editar</Button></DialogFooter>}
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Endereço"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Investimento"><Input value={f.investmentText} onChange={(e) => setF({ ...f, investmentText: e.target.value })} placeholder="R$ 45.000" /></Field>
            <Field label="Nº de pessoas"><Input type="number" value={f.userCount} onChange={(e) => setF({ ...f, userCount: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.hasProject} onChange={(e) => setF({ ...f, hasProject: e.target.checked })} /> Já tem projeto de arquiteto</label>
          <Field label="Ambientes">
            <div className="grid grid-cols-2 gap-1.5">
              {ENV_LIST.map((e) => (
                <label key={e} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={f.environments.includes(e)} onChange={() => setF({ ...f, environments: f.environments.includes(e) ? f.environments.filter((x) => x !== e) : [...f.environments, e] })} />
                  {e}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Como conheceu">
            <Select value={f.discoveryChannel || "NONE"} onValueChange={(v) => setF({ ...f, discoveryChannel: v === "NONE" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent><SelectItem value="NONE">—</SelectItem>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Observações"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <DialogFooter>
            {b && <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>}
            <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
          </DialogFooter>
        </div>
      )}
    </>
  );
}

type BriefingData = { address: string | null; investmentEstimate: number | null; investmentText: string | null; hasProject: boolean; environments: string[]; userCount: number | null; discoveryChannel: string | null; notes: string | null; origin: "PUBLIC" | "CONSULTANT"; submittedAt: string };
type BriefingForm = { address: string; investmentText: string; hasProject: boolean; environments: string[]; userCount: string; discoveryChannel: string; notes: string };

function useMemoInit(b: BriefingData | null, setF: (f: BriefingForm) => void, setEditing: (v: boolean) => void) {
  const key = b ? b.submittedAt : "new";
  useEffect(() => {
    if (b) setF({ address: b.address ?? "", investmentText: b.investmentText ?? "", hasProject: b.hasProject, environments: b.environments, userCount: b.userCount != null ? String(b.userCount) : "", discoveryChannel: b.discoveryChannel ?? "", notes: b.notes ?? "" });
    else setEditing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

function Row({ k, v }: { k: string; v: string | null }) {
  return <div className="flex gap-2"><span className="w-32 shrink-0 text-muted-foreground">{k}</span><span className="font-medium">{v || "—"}</span></div>;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={`space-y-2 ${className}`}><Label>{label}</Label>{children}</div>;
}
