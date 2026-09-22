import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, History, Loader2, Plus, Ruler, Star } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPatch, apiPost, apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { compressImage } from "@/lib/image";
import { useAuth } from "@/hooks/use-auth";

// ---------------------------------------------------------------------------
// Medidas por ambiente
// ---------------------------------------------------------------------------

type Medida = {
  id: string;
  name: string;
  version: number;
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;
  ceilingHeightMm: number | null;
  plumbingPoints: string | null;
  electricalPoints: string | null;
  interferences: string | null;
  notes: string | null;
  current: boolean;
  createdBy: { name: string } | null;
  createdAt: string;
};

const mm = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("pt-BR")} mm`);
const vazio = { name: "", widthMm: "", heightMm: "", depthMm: "", ceilingHeightMm: "", plumbingPoints: "", electricalPoints: "", interferences: "", notes: "" };
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

/** Medidas por ambiente da medição, com versões. */
export function MeasurementRooms({ measurementId }: { measurementId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const podeEditar = can("organization.manage");
  const [form, setForm] = useState(vazio);
  const [abrindo, setAbrindo] = useState(false);
  const [historico, setHistorico] = useState<Medida | null>(null);
  const [editando, setEditando] = useState<Medida | null>(null);

  const q = useQuery({
    queryKey: ["measure-rooms", measurementId],
    queryFn: () => apiGet<{ data: Medida[] }>(`/fieldwork/measurements/${measurementId}/rooms`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["measure-rooms", measurementId] });

  const payload = (f: typeof vazio) => ({
    name: f.name,
    widthMm: numOrNull(f.widthMm),
    heightMm: numOrNull(f.heightMm),
    depthMm: numOrNull(f.depthMm),
    ceilingHeightMm: numOrNull(f.ceilingHeightMm),
    plumbingPoints: f.plumbingPoints || null,
    electricalPoints: f.electricalPoints || null,
    interferences: f.interferences || null,
    notes: f.notes || null,
  });

  const criar = useMutation({
    mutationFn: () => apiPost(`/fieldwork/measurements/${measurementId}/rooms`, payload(form)),
    onSuccess: () => { toast.success("Medidas registradas"); setForm(vazio); setAbrindo(false); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível registrar")),
  });

  const salvarEdicao = useMutation({
    mutationFn: (p: { id: string; body: Record<string, unknown> }) => apiPatch<{ message?: string }>(`/fieldwork/measurement-rooms/${p.id}`, p.body),
    onSuccess: (r) => { toast.success(r.message ?? "Nova versão registrada"); setEditando(null); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar")),
  });

  const rooms = q.data?.data ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><Ruler className="h-4 w-4" /> Medidas por ambiente ({rooms.length})</span>
          {podeEditar && <Button size="sm" onClick={() => setAbrindo(true)}><Plus className="h-4 w-4" /> Ambiente</Button>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">Medidas em milímetros. Editar não apaga: cria a versão seguinte, e a anterior fica no histórico.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma medida registrada.</p>
        ) : (
          rooms.map((m) => (
            <div key={m.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {m.name} {m.version > 1 && <Badge variant="secondary">v{m.version}</Badge>}
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setHistorico(m)} title="Histórico de versões"><History className="h-4 w-4" /></Button>
                  {podeEditar && <Button size="sm" variant="outline" onClick={() => setEditando(m)}>Editar</Button>}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                L {mm(m.widthMm)} · A {mm(m.heightMm)} · P {mm(m.depthMm)} · pé-direito {mm(m.ceilingHeightMm)}
              </p>
              {(m.plumbingPoints || m.electricalPoints || m.interferences) && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {m.plumbingPoints && <li><strong>Hidráulica:</strong> {m.plumbingPoints}</li>}
                  {m.electricalPoints && <li><strong>Elétrica:</strong> {m.electricalPoints}</li>}
                  {m.interferences && <li><strong>Interferências:</strong> {m.interferences}</li>}
                </ul>
              )}
              {m.notes && <p className="mt-1 text-xs text-muted-foreground">{m.notes}</p>}
            </div>
          ))
        )}
      </CardContent>

      {(abrindo || editando) && (
        <Dialog open onOpenChange={() => { setAbrindo(false); setEditando(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editando ? `Editar ${editando.name} (vira v${editando.version + 1})` : "Novo ambiente"}</DialogTitle>
            </DialogHeader>
            <MedidaForm
              inicial={
                editando
                  ? {
                      name: editando.name,
                      widthMm: editando.widthMm?.toString() ?? "",
                      heightMm: editando.heightMm?.toString() ?? "",
                      depthMm: editando.depthMm?.toString() ?? "",
                      ceilingHeightMm: editando.ceilingHeightMm?.toString() ?? "",
                      plumbingPoints: editando.plumbingPoints ?? "",
                      electricalPoints: editando.electricalPoints ?? "",
                      interferences: editando.interferences ?? "",
                      notes: editando.notes ?? "",
                    }
                  : form
              }
              pedeMotivo={Boolean(editando)}
              salvando={criar.isPending || salvarEdicao.isPending}
              onCancel={() => { setAbrindo(false); setEditando(null); }}
              onSubmit={(f, motivo) => {
                if (editando) salvarEdicao.mutate({ id: editando.id, body: { ...payload(f), reason: motivo || undefined } });
                else { setForm(f); criar.mutate(); }
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {historico && <HistoricoMedidas medida={historico} onClose={() => setHistorico(null)} />}
    </Card>
  );
}

function MedidaForm({
  inicial,
  pedeMotivo,
  salvando,
  onCancel,
  onSubmit,
}: {
  inicial: typeof vazio;
  pedeMotivo: boolean;
  salvando: boolean;
  onCancel: () => void;
  onSubmit: (f: typeof vazio, motivo: string) => void;
}) {
  const [f, setF] = useState(inicial);
  const [motivo, setMotivo] = useState("");
  const campo = (k: keyof typeof vazio, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </div>
  );
  return (
    <>
      <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        <div className="sm:col-span-2">{campo("name", "Ambiente *", { placeholder: "Cozinha, suíte master…" })}</div>
        {campo("widthMm", "Largura (mm)", { inputMode: "numeric" })}
        {campo("heightMm", "Altura (mm)", { inputMode: "numeric" })}
        {campo("depthMm", "Profundidade (mm)", { inputMode: "numeric" })}
        {campo("ceilingHeightMm", "Pé-direito (mm)", { inputMode: "numeric" })}
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Pontos hidráulicos</Label>
          <Textarea rows={2} value={f.plumbingPoints} onChange={(e) => setF({ ...f, plumbingPoints: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Pontos elétricos</Label>
          <Textarea rows={2} value={f.electricalPoints} onChange={(e) => setF({ ...f, electricalPoints: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Interferências (viga, pilar, janela, gás…)</Label>
          <Textarea rows={2} value={f.interferences} onChange={(e) => setF({ ...f, interferences: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Observações</Label>
          <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
      </div>
      {pedeMotivo && (
        <div className="space-y-1.5">
          <Label className="text-xs">Por que mudou (vai para o histórico)</Label>
          <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Remedido no local" />
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSubmit(f, motivo)} disabled={salvando || !f.name.trim()}>
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
        </Button>
      </DialogFooter>
    </>
  );
}

function HistoricoMedidas({ medida, onClose }: { medida: Medida; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["measure-history", medida.id],
    queryFn: () => apiGet<{ data: Medida[] }>(`/fieldwork/measurement-rooms/${medida.id}/history`),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Versões de {medida.name}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {(q.data?.data ?? []).map((v) => (
            <div key={v.id} className={`rounded-md border p-2 text-sm ${v.current ? "border-primary" : "border-border opacity-80"}`}>
              <p className="font-medium">v{v.version} {v.current && <Badge variant="secondary">atual</Badge>}</p>
              <p className="text-xs text-muted-foreground">L {mm(v.widthMm)} · A {mm(v.heightMm)} · P {mm(v.depthMm)} · pé-direito {mm(v.ceilingHeightMm)}</p>
              <p className="text-[11px] text-muted-foreground">{v.createdBy?.name ?? "—"} · {new Date(v.createdAt).toLocaleString("pt-BR")}</p>
            </div>
          ))}
        </div>
        <DialogFooter><Button onClick={onClose}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Diário de montagem
// ---------------------------------------------------------------------------

type Entrada = {
  id: string;
  description: string;
  progressPct: number | null;
  problems: string | null;
  materialsUsed: string | null;
  missingParts: string | null;
  createdAt: string;
  author: { name: string } | null;
  contractor: { name: string } | null;
  room: { name: string } | null;
  attachments: { id: string; kind: string; fileName: string; mimeType: string | null }[];
};

/**
 * Diário da montagem. `basePath` permite usar a mesma tela na área do montador
 * (/me/contractor/projects/:id/diary) e na da equipe (/fieldwork/...).
 */
export function InstallationDiary({ projectId, basePath = "/fieldwork", podeEscrever }: { projectId: string; basePath?: string; podeEscrever: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ description: "", progressPct: "", problems: "", missingParts: "", materialsUsed: "" });
  const [arquivos, setArquivos] = useState<File[]>([]);

  const path = `${basePath}/projects/${projectId}/diary`;
  const q = useQuery({ queryKey: ["diary", projectId, basePath], queryFn: () => apiGet<{ data: Entrada[] }>(path) });

  const enviar = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("description", f.description);
      if (f.progressPct) fd.append("progressPct", f.progressPct);
      for (const k of ["problems", "missingParts", "materialsUsed"] as const) if (f[k]) fd.append(k, f[k]);
      for (const a of arquivos) fd.append("files", a.type.startsWith("image/") ? await compressImage(a) : a);
      return apiPostForm<{ message?: string }>(path, fd);
    },
    onSuccess: (r) => {
      toast.success(r.message ?? "Registro adicionado");
      setF({ description: "", progressPct: "", problems: "", missingParts: "", materialsUsed: "" });
      setArquivos([]);
      qc.invalidateQueries({ queryKey: ["diary", projectId] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível registrar")),
  });

  const entradas = q.data?.data ?? [];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Diário da montagem ({entradas.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {podeEscrever && (
          <form
            className="space-y-2 rounded-lg border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (f.description.trim().length >= 3) enviar.mutate();
            }}
          >
            <Textarea rows={2} placeholder="O que foi feito hoje?" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <div className="grid gap-2 sm:grid-cols-4">
              <Input type="number" min={0} max={100} placeholder="% concluído" value={f.progressPct} onChange={(e) => setF({ ...f, progressPct: e.target.value })} />
              <Input placeholder="Problemas" value={f.problems} onChange={(e) => setF({ ...f, problems: e.target.value })} />
              <Input placeholder="Peças faltando" value={f.missingParts} onChange={(e) => setF({ ...f, missingParts: e.target.value })} />
              <Input placeholder="Materiais usados" value={f.materialsUsed} onChange={(e) => setF({ ...f, materialsUsed: e.target.value })} />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*,application/pdf"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => { setArquivos([...(e.target.files ?? [])].slice(0, 10)); e.target.value = ""; }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Camera className="h-4 w-4" /> Fotos / vídeo
              </Button>
              {arquivos.length > 0 && <span className="text-xs text-muted-foreground">{arquivos.length} arquivo(s)</span>}
              <Button type="submit" size="sm" className="ml-auto" disabled={enviar.isPending || f.description.trim().length < 3}>
                {enviar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Registrar
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Fotos são comprimidas antes de enviar. Vídeo longo pode não passar no limite do servidor.</p>
          </form>
        )}

        {entradas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
        ) : (
          entradas.map((e) => (
            <div key={e.id} className="border-l-2 border-border pl-3 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{e.contractor?.name ?? e.author?.name ?? "—"}</span>
                <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString("pt-BR")}</span>
                {e.progressPct !== null && <Badge variant="secondary">{e.progressPct}%</Badge>}
                {e.room && <span className="text-xs text-muted-foreground">{e.room.name}</span>}
              </p>
              <p className="whitespace-pre-wrap">{e.description}</p>
              {e.problems && <p className="text-xs text-destructive">Problema: {e.problems}</p>}
              {e.missingParts && <p className="text-xs text-warning">Falta: {e.missingParts}</p>}
              {e.materialsUsed && <p className="text-xs text-muted-foreground">Materiais: {e.materialsUsed}</p>}
              {e.attachments.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {e.attachments.map((a) => (
                    <a key={a.id} href={`/api/fieldwork/diary-attachments/${a.id}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                      {a.kind === "FOTO" ? "📷" : a.kind === "VIDEO" ? "🎬" : "📄"} {a.fileName}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Avaliação do montador
// ---------------------------------------------------------------------------

type Avaliacao = { id: string; contractor: { id: string; name: string }; average: number; rework: boolean; notes: string | null; ratedBy: { name: string } | null };

const CRITERIOS = [
  ["quality", "Qualidade"],
  ["deadline", "Prazo"],
  ["organizationScore", "Organização"],
  ["finish", "Acabamento"],
  ["service", "Atendimento"],
] as const;

/** Avaliação dos montadores que trabalharam na obra. */
export function ContractorRatings({ projectId }: { projectId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const podeAvaliar = can("contractors.manage");
  const [aberto, setAberto] = useState(false);
  const [v, setV] = useState({ contractorId: "", quality: 5, deadline: 5, organizationScore: 5, finish: 5, service: 5, rework: false, reworkNotes: "", notes: "" });

  const q = useQuery({
    queryKey: ["ratings", projectId],
    queryFn: () => apiGet<{ data: Avaliacao[] }>(`/fieldwork/projects/${projectId}/ratings`),
    enabled: podeAvaliar || can("hr.read"),
  });
  const montadores = useQuery({
    queryKey: ["project-contractors", projectId],
    queryFn: () => apiGet<{ data: { id: string; name: string }[] }>(`/fieldwork/projects/${projectId}/contractors`),
    enabled: aberto,
  });

  const salvar = useMutation({
    mutationFn: () => apiPost<{ message?: string }>(`/fieldwork/projects/${projectId}/ratings`, v),
    onSuccess: (r) => {
      toast.success(r.message ?? "Avaliação registrada");
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["ratings", projectId] });
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível avaliar")),
  });

  const itens = q.data?.data ?? [];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><Star className="h-4 w-4" /> Avaliação da montagem</span>
          {podeAvaliar && <Button size="sm" onClick={() => setAberto(true)}><Plus className="h-4 w-4" /> Avaliar</Button>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma avaliação registrada.</p>
        ) : (
          itens.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span>
                <strong>{a.contractor.name}</strong> · nota {a.average.toLocaleString("pt-BR")}
                {a.rework && <Badge variant="warning" className="ml-2">retrabalho</Badge>}
              </span>
              <span className="text-xs text-muted-foreground">{a.ratedBy?.name}</span>
            </div>
          ))
        )}
      </CardContent>

      {aberto && (
        <Dialog open onOpenChange={() => setAberto(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Avaliar montagem</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Montador</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={v.contractorId}
                  onChange={(e) => setV({ ...v, contractorId: e.target.value })}
                >
                  <option value="">Selecione</option>
                  {(montadores.data?.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              {CRITERIOS.map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <Label className="text-sm">{label}</Label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setV({ ...v, [k]: n })}
                        aria-label={`${label}: ${n}`}
                        className={`h-8 w-8 rounded-md border text-sm ${v[k] === n ? "border-primary bg-primary/10 font-semibold" : "border-border"}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={v.rework} onChange={(e) => setV({ ...v, rework: e.target.checked })} /> Precisou de retrabalho
              </label>
              {v.rework && <Textarea rows={2} placeholder="O que precisou refazer *" value={v.reworkNotes} onChange={(e) => setV({ ...v, reworkNotes: e.target.value })} />}
              <Textarea rows={2} placeholder="Observações" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
              <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !v.contractorId || (v.rework && !v.reworkNotes.trim())}>
                {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
