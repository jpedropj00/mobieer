import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckCircle2, ClipboardCheck, Download, FileText, Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiDownload, apiGet, apiPatch, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { cn, formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/signature-pad";
import { FileAttachments } from "@/components/file-attachments";

type ItemStatus = "CONFORME" | "NAO_CONFORME" | "NAO_APLICA";
type Result = "APPROVED" | "APPROVED_WITH_REMARKS" | "REJECTED";
type Inspection = {
  id: string;
  status: "DRAFT" | "COMPLETED";
  result: Result | null;
  resultLabel: string | null;
  inspectedAt: string;
  ambientes: string | null;
  technician: { id: string; name: string } | null;
  installerNames: string | null;
  pendencias: string | null;
  notes: string | null;
  clientSignerName: string | null;
  signedByClient: boolean;
  signedByTechnician: boolean;
  completedAt: string | null;
  report: { id: string; title: string; version: number } | null;
  progress: { answered: number; total: number; nonConforming: number };
  photoCount: number;
  items: { id: string; section: string; label: string; position: number; status: ItemStatus | null; note: string | null }[];
};
type Coverage = { key: string; label: string; detail?: string; months: number; endsAt: string; daysLeft: number; state: "ACTIVE" | "EXPIRING" | "EXPIRED" };
type Maintenance = { id: string; label: string; dueAt: string; status: "SCHEDULED" | "DONE" | "CANCELLED"; overdue: boolean; remindedAt: string | null; doneAt: string | null; doneBy: { name: string } | null; notes: string | null };
type Aftersales = {
  inspections: Inspection[];
  warranty: { id: string; startsAt: string; endsAt: string; coverage: Coverage[]; conditions: string; exclusions: string[]; certificate: { id: string; title: string; version: number } | null } | null;
  maintenances: Maintenance[];
};

const STATUS_BTN: { key: ItemStatus; short: string; cls: string }[] = [
  { key: "CONFORME", short: "C", cls: "data-[on=true]:bg-success data-[on=true]:text-white" },
  { key: "NAO_CONFORME", short: "NC", cls: "data-[on=true]:bg-destructive data-[on=true]:text-white" },
  { key: "NAO_APLICA", short: "NA", cls: "data-[on=true]:bg-muted-foreground data-[on=true]:text-white" },
];
const RESULT_VARIANT: Record<Result, "success" | "warning" | "danger"> = { APPROVED: "success", APPROVED_WITH_REMARKS: "warning", REJECTED: "danger" };
const years = (m: number) => (m % 12 === 0 ? `${m / 12} ${m === 12 ? "ano" : "anos"}` : `${m} meses`);
const fail = (e: unknown) => toast.error(errorMessage(e, "Não foi possível concluir"));
const download = (id: string, name: string) => apiDownload(`/documents/${id}/download`, `${name}.pdf`).catch(fail);

/** §35–§38 — pós-venda do projeto: vistoria, garantia, certificado e revisões. */
export function AftersalesPanel({ projectId }: { projectId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const key = ["aftersales", projectId];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: Aftersales }>(`/aftersales/projects/${projectId}`) });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    // documentos gerados (relatório, certificado) aparecem na aba Documentos
    qc.invalidateQueries({ queryKey: ["project", projectId] });
  };
  const [open, setOpen] = useState<string | null>(null);
  const [manualStart, setManualStart] = useState("");

  const act = useMutation({
    mutationFn: (fn: () => Promise<{ message?: string }>) => fn(),
    onSuccess: (r) => {
      if (r.message) toast.success(r.message);
      invalidate();
    },
    onError: fail,
  });

  if (q.isLoading) return <p className="py-6 text-center text-sm text-muted-foreground">Carregando pós-venda...</p>;
  if (q.isError || !q.data) return <p className="py-6 text-center text-sm text-destructive">{errorMessage(q.error, "Falha ao carregar")}</p>;
  const d = q.data.data;
  const draft = d.inspections.find((i) => i.status === "DRAFT");
  const current = d.inspections.find((i) => i.id === open);

  return (
    <div className="space-y-4">
      {/* Vistoria */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 py-3">
          <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-5 w-5" /> Vistoria técnica de montagem</CardTitle>
          {can("inspections.manage") && !draft && (
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate(async () => {
              const r = await apiPost<{ data: Inspection; message: string }>(`/aftersales/projects/${projectId}/inspections`, {});
              setOpen(r.data.id);
              return r;
            })}>
              <Plus className="h-4 w-4" /> Nova vistoria
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {d.inspections.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma vistoria. Depois da montagem, abra uma vistoria com o checklist padrão da Mobieer.</p>
          ) : (
            d.inspections.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {formatDate(i.inspectedAt)} · {i.technician?.name ?? "sem técnico"}
                    {i.status === "DRAFT" ? <Badge variant="muted">Em preenchimento</Badge> : i.result && <Badge variant={RESULT_VARIANT[i.result]}>{i.resultLabel}</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i.progress.answered}/{i.progress.total} itens · {i.progress.nonConforming} não conforme(s) · {i.photoCount} foto(s)
                  </p>
                </div>
                <div className="flex gap-2">
                  {i.report && (
                    <Button size="sm" variant="outline" onClick={() => download(i.report!.id, i.report!.title)}>
                      <FileText className="h-4 w-4" /> Relatório
                    </Button>
                  )}
                  <Button size="sm" variant={i.status === "DRAFT" ? "default" : "outline"} onClick={() => setOpen(i.id)}>
                    {i.status === "DRAFT" ? "Continuar" : "Ver"}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Garantia */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 py-3">
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5" /> Garantia</CardTitle>
          {d.warranty && can("warranty.manage") && (
            <div className="flex gap-2">
              {d.warranty.certificate && (
                <Button size="sm" variant="outline" onClick={() => download(d.warranty!.certificate!.id, "certificado-de-garantia")}>
                  <Download className="h-4 w-4" /> Certificado v{d.warranty.certificate.version}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate(() => apiPost(`/aftersales/warranties/${d.warranty!.id}/certificate`))}>
                <RefreshCw className="h-4 w-4" /> Reemitir
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {d.warranty ? (
            <>
              <p className="text-muted-foreground">Vigente desde {formatDate(d.warranty.startsAt)} (vistoria final) até {formatDate(d.warranty.endsAt)}.</p>
              <ul className="divide-y rounded-lg border">
                {d.warranty.coverage.map((c) => (
                  <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                    <span>{c.label}{c.detail && <span className="text-xs text-muted-foreground"> — {c.detail}</span>}</span>
                    <span className="flex items-center gap-2">
                      {years(c.months)} · até {formatDate(c.endsAt)}
                      {c.state === "EXPIRING" && <Badge variant="warning">{c.daysLeft} dia(s)</Badge>}
                      {c.state === "EXPIRED" && <Badge variant="muted">encerrada</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground">A garantia nasce da vistoria aprovada (com ou sem ressalvas), com certificado e revisões preventivas.</p>
              {can("warranty.manage") && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Projeto vistoriado no papel? Registre a data da vistoria final</Label>
                    <Input type="date" className="w-44" value={manualStart} onChange={(e) => setManualStart(e.target.value)} />
                  </div>
                  <Button size="sm" variant="outline" disabled={!manualStart || act.isPending} onClick={() => act.mutate(() => apiPost(`/aftersales/projects/${projectId}/warranty`, { startsAt: `${manualStart}T12:00:00` }))}>
                    Registrar garantia
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revisões */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-5 w-5" /> Manutenção preventiva</CardTitle>
        </CardHeader>
        <CardContent>
          {d.maintenances.length === 0 ? (
            <p className="text-sm text-muted-foreground">As revisões são agendadas automaticamente quando a garantia é aberta.</p>
          ) : (
            <ul className="space-y-2">
              {d.maintenances.map((m) => (
                <MaintenanceRow key={m.id} m={m} canManage={can("warranty.manage")} busy={act.isPending} onAct={(body) => act.mutate(() => apiPatch(`/aftersales/maintenances/${m.id}`, body))} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {current && <InspectionDialog inspection={current} canEdit={can("inspections.manage")} onClose={() => setOpen(null)} onChanged={invalidate} />}
    </div>
  );
}

function MaintenanceRow({ m, canManage, busy, onAct }: { m: Maintenance; canManage: boolean; busy: boolean; onAct: (body: Record<string, unknown>) => void }) {
  const [date, setDate] = useState(m.dueAt.slice(0, 10));
  return (
    <li className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm", m.overdue && "border-warning/60")}>
      <span>
        <span className="font-medium">{m.label}</span>
        <span className="block text-xs text-muted-foreground">
          {m.status === "DONE" ? `feita em ${formatDate(m.doneAt)}${m.doneBy ? ` por ${m.doneBy.name}` : ""}` : m.status === "CANCELLED" ? "cancelada" : `prevista para ${formatDate(m.dueAt)}${m.overdue ? " · atrasada" : ""}${m.remindedAt ? " · cliente avisado" : ""}`}
          {m.notes ? ` · ${m.notes}` : ""}
        </span>
      </span>
      {canManage && (
        <span className="flex flex-wrap items-center gap-2">
          {m.status === "SCHEDULED" ? (
            <>
              <Input type="date" className="h-8 w-36" value={date} onChange={(e) => setDate(e.target.value)} />
              {date !== m.dueAt.slice(0, 10) && <Button size="sm" variant="outline" disabled={busy} onClick={() => onAct({ dueAt: `${date}T12:00:00` })}>Remarcar</Button>}
              <Button size="sm" disabled={busy} onClick={() => onAct({ action: "DONE" })}><CheckCircle2 className="h-4 w-4" /> Feita</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const n = prompt("Motivo do cancelamento:"); if (n) onAct({ action: "CANCEL", notes: n }); }}>Cancelar</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAct({ action: "REOPEN" })}>Reabrir</Button>
          )}
        </span>
      )}
    </li>
  );
}

function InspectionDialog({ inspection: i, canEdit, onClose, onChanged }: { inspection: Inspection; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const editable = canEdit && i.status === "DRAFT";
  const [items, setItems] = useState(i.items);
  const [ambientes, setAmbientes] = useState(i.ambientes ?? "");
  const [installers, setInstallers] = useState(i.installerNames ?? "");
  const [pendencias, setPendencias] = useState(i.pendencias ?? "");
  const [notes, setNotes] = useState(i.notes ?? "");
  const [finishing, setFinishing] = useState(false);
  useEffect(() => setItems(i.items), [i.items]);

  const dirty = useMemo(
    () =>
      items.some((x, k) => x.status !== i.items[k]?.status || (x.note ?? "") !== (i.items[k]?.note ?? "")) ||
      ambientes !== (i.ambientes ?? "") || installers !== (i.installerNames ?? "") || pendencias !== (i.pendencias ?? "") || notes !== (i.notes ?? ""),
    [items, ambientes, installers, pendencias, notes, i]
  );
  const save = useMutation({
    mutationFn: () =>
      apiPatch<{ message: string }>(`/aftersales/inspections/${i.id}`, {
        ambientes, installerNames: installers, pendencias, notes,
        items: items.filter((x, k) => x.status !== i.items[k]?.status || (x.note ?? "") !== (i.items[k]?.note ?? "")).map((x) => ({ id: x.id, status: x.status, note: x.note })),
      }),
    onSuccess: () => { toast.success("Vistoria salva"); onChanged(); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/aftersales/inspections/${i.id}`),
    onSuccess: () => { toast.success("Rascunho excluído"); onChanged(); onClose(); },
    onError: fail,
  });

  const set = (id: string, patch: Partial<Inspection["items"][number]>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const sections = [...new Set(items.map((x) => x.section))];
  const answered = items.filter((x) => x.status).length;

  return (
    <Dialog open onOpenChange={(o) => !o && !dirty && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Vistoria de {formatDate(i.inspectedAt)}
            {i.status === "COMPLETED" && i.result && <Badge variant={RESULT_VARIANT[i.result]}>{i.resultLabel}</Badge>}
            <span className="text-sm font-normal text-muted-foreground">{answered}/{items.length} itens</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">Ambiente(s)</Label><Input disabled={!editable} value={ambientes} onChange={(e) => setAmbientes(e.target.value)} placeholder="Cozinha, Closet..." /></div>
            <div className="space-y-1"><Label className="text-xs">Montador(es)</Label><Input disabled={!editable} value={installers} onChange={(e) => setInstallers(e.target.value)} /></div>
          </div>
          {editable && (
            <Button size="sm" variant="outline" onClick={() => setItems((xs) => xs.map((x) => (x.status ? x : { ...x, status: "CONFORME" })))}>
              Marcar os itens em branco como conformes
            </Button>
          )}
          {sections.map((sec) => (
            <div key={sec} className="rounded-lg border">
              <p className="border-b bg-muted/40 px-3 py-2 text-sm font-semibold">{sec}</p>
              <ul className="divide-y">
                {items.filter((x) => x.section === sec).map((x) => (
                  <li key={x.id} className="space-y-1.5 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={cn("text-sm", x.status === "NAO_CONFORME" && "font-medium text-destructive")}>{x.label}</span>
                      <span className="flex gap-1">
                        {STATUS_BTN.map((b) => (
                          <button
                            key={b.key}
                            type="button"
                            disabled={!editable}
                            data-on={x.status === b.key}
                            aria-pressed={x.status === b.key}
                            aria-label={`${x.label}: ${b.short}`}
                            onClick={() => set(x.id, { status: x.status === b.key ? null : b.key })}
                            className={cn("h-8 min-w-[2.5rem] rounded-md border px-2 text-xs font-semibold transition disabled:cursor-default", b.cls)}
                          >
                            {b.short}
                          </button>
                        ))}
                      </span>
                    </div>
                    {(x.status === "NAO_CONFORME" || x.note) && (
                      <Input disabled={!editable} className="h-8 text-xs" placeholder="Observação" value={x.note ?? ""} onChange={(e) => set(x.id, { note: e.target.value })} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="space-y-1"><Label className="text-xs">Pendências</Label><Textarea disabled={!editable} rows={3} value={pendencias} onChange={(e) => setPendencias(e.target.value)} placeholder="Ex.: tapa-furo cinza, regulagem das portas do G-volume" /></div>
          <div className="space-y-1"><Label className="text-xs">Observações</Label><Textarea disabled={!editable} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="space-y-1">
            <Label className="text-xs">Fotos da vistoria</Label>
            <FileAttachments entity="SiteInspection" entityId={i.id} canWrite={canEdit} category="FOTO" onChange={onChanged} />
          </div>
          {i.status === "COMPLETED" && (
            <p className="text-xs text-muted-foreground">
              Concluída em {formatDate(i.completedAt, true)} · técnico {i.signedByTechnician ? "assinou" : "não assinou"} · cliente {i.signedByClient ? `assinou (${i.clientSignerName})` : "não assinou"}.
            </p>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          {editable && (
            <Button variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => { if (confirm("Excluir este rascunho de vistoria?")) remove.mutate(); }}>
              <Trash2 className="h-4 w-4" /> Excluir rascunho
            </Button>
          )}
          <Button variant="outline" onClick={() => { if (!dirty || confirm("Sair sem salvar as alterações?")) onClose(); }}>Fechar</Button>
          {editable && (
            <>
              <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
              </Button>
              <Button disabled={dirty || save.isPending} title={dirty ? "Salve antes de concluir" : undefined} onClick={() => setFinishing(true)}>
                <CheckCircle2 className="h-4 w-4" /> Concluir vistoria
              </Button>
            </>
          )}
        </DialogFooter>
        {finishing && (
          <FinishDialog
            inspection={i}
            nonConforming={items.filter((x) => x.status === "NAO_CONFORME").length}
            pendencias={pendencias}
            onClose={() => setFinishing(false)}
            onDone={() => { setFinishing(false); onChanged(); onClose(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FinishDialog({ inspection, nonConforming, pendencias, onClose, onDone }: { inspection: Inspection; nonConforming: number; pendencias: string; onClose: () => void; onDone: () => void }) {
  const [result, setResult] = useState<Result>(nonConforming ? "APPROVED_WITH_REMARKS" : "APPROVED");
  const [pend, setPend] = useState(pendencias);
  const [signer, setSigner] = useState("");
  const [clientSig, setClientSig] = useState<string | null>(null);
  const [techSig, setTechSig] = useState<string | null>(null);
  const done = useMutation({
    mutationFn: () =>
      apiPost<{ message: string }>(`/aftersales/inspections/${inspection.id}/complete`, {
        result, pendencias: pend, clientSignerName: signer || null, clientSignature: clientSig, technicianSignature: techSig,
      }),
    onSuccess: (r) => { toast.success(r.message); onDone(); },
    onError: fail,
  });
  const options: { key: Result; label: string }[] = [
    { key: "APPROVED", label: "Entrega aprovada sem ressalvas" },
    { key: "APPROVED_WITH_REMARKS", label: "Entrega aprovada com ressalvas" },
    { key: "REJECTED", label: "Entrega não aprovada" },
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>Termo de entrega</DialogTitle></DialogHeader>
        <div className="space-y-4 text-sm">
          {nonConforming > 0 && <p className="rounded-md bg-warning/10 p-2 text-xs">{nonConforming} item(ns) não conforme(s): a entrega não pode sair "sem ressalvas".</p>}
          <div className="space-y-2">
            {options.map((o) => (
              <label key={o.key} className={cn("flex items-center gap-2", o.key === "APPROVED" && nonConforming > 0 && "opacity-50")}>
                <input type="radio" name="result" checked={result === o.key} disabled={o.key === "APPROVED" && nonConforming > 0} onChange={() => setResult(o.key)} />
                {o.label}
              </label>
            ))}
          </div>
          {result !== "APPROVED" && (
            <div className="space-y-1"><Label className="text-xs">Pendências *</Label><Textarea rows={3} value={pend} onChange={(e) => setPend(e.target.value)} /></div>
          )}
          <div className="space-y-1"><Label className="text-xs">Assinatura do técnico</Label><SignaturePad onChange={setTechSig} /></div>
          <div className="space-y-1"><Label className="text-xs">Nome de quem assina pelo cliente</Label><Input value={signer} onChange={(e) => setSigner(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Assinatura do cliente</Label><SignaturePad onChange={setClientSig} /></div>
          <p className="text-xs text-muted-foreground">
            Ao concluir, o relatório em PDF vai para os documentos do projeto (visível ao cliente) e, se a entrega for aprovada, a garantia é aberta com certificado e revisões preventivas.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button disabled={done.isPending || (!!clientSig && !signer)} onClick={() => done.mutate()}>
            {done.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Concluir e emitir relatório
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
