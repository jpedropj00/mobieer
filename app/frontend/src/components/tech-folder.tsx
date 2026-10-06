import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FileDown, FileText, FolderUp, ImagePlus, Loader2, PencilLine, PencilRuler, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiObjectUrl, apiOpen, apiPost, apiPostForm, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { TechDrawingDialog, type DrawingSpec } from "@/components/tech-drawing-dialog";
import { SheetAnnotator } from "@/components/sheet-annotator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pdfPageToDataUrl } from "@/lib/pdf-preview";
import { getToken } from "@/services/api";

type Sheet = { id: string; room: string; title: string; scale: string | null; note: string | null; fileName: string; mime: string; page: number | null; stamp: boolean; drawing?: DrawingSpec; annotated?: boolean };
type Spec = { room: string; rows: { label: string; value: string }[]; description: string | null };
type Folder = { sheets: Sheet[]; includeSpecs: boolean; notes: string[]; specs: Spec[]; rooms: string[]; quote: { number: string; status: string } | null; titles: string[]; scales: string[]; area?: { w: number; h: number }; ai?: { image: boolean } };

/** Tela de anotar uma prancha: carrega a prancha de fundo e as anotações já salvas. */
function AnnotateDialog({ base, sheet, aspect, onClose, onSaved }: { base: string; sheet: Sheet | null; aspect: number; onClose: () => void; onSaved: (d: Folder) => void }) {
  const [bg, setBg] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const getter = useRef<() => string | null>(() => null);
  const register = useRef((fn: () => string | null) => { getter.current = fn; }).current;

  useEffect(() => {
    if (!sheet) return;
    let alive = true;
    const made: string[] = [];
    setBg(null); setOverlay(null); setReady(false);
    const headers = { Authorization: `Bearer ${getToken() ?? ""}` };
    (async () => {
      try {
        const r = await fetch(`/api${base}/sheets/${sheet.id}/file`, { headers });
        if (r.ok) {
          if (sheet.mime === "application/pdf") {
            const url = await pdfPageToDataUrl(await r.arrayBuffer(), sheet.page ?? 0);
            if (alive) setBg(url);
          } else {
            const url = URL.createObjectURL(await r.blob());
            made.push(url);
            if (alive) setBg(url);
          }
        }
      } catch {
        // sem fundo dá para anotar do mesmo jeito
      }
      if (sheet.annotated) {
        try {
          const r = await fetch(`/api${base}/sheets/${sheet.id}/overlay`, { headers });
          if (r.ok) {
            const url = URL.createObjectURL(await r.blob());
            made.push(url);
            if (alive) setOverlay(url);
          }
        } catch {
          // começa em branco
        }
      }
      if (alive) setReady(true);
    })();
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [base, sheet]);

  const save = useMutation({
    mutationFn: () => {
      const dataUrl = getter.current();
      return dataUrl ? apiPut<{ data: Folder; message?: string }>(`${base}/sheets/${sheet!.id}/overlay`, { dataUrl }) : apiDelete<{ data: Folder; message?: string }>(`${base}/sheets/${sheet!.id}/overlay`);
    },
    onSuccess: (r) => { toast.success(r.message ?? "Anotações salvas"); onSaved(r.data); onClose(); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar as anotações")),
  });

  return (
    <Dialog open={sheet !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Anotar — {sheet?.title}</DialogTitle>
          <DialogDescription>Desenhe e escreva por cima da prancha. As anotações saem no PDF da pasta técnica, no mesmo lugar.</DialogDescription>
        </DialogHeader>
        {sheet && ready ? (
          <SheetAnnotator key={`${sheet.id}-${overlay ?? ""}`} backgroundUrl={bg} initialOverlayUrl={overlay} aspect={aspect} registerGetter={register} />
        ) : (
          <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salvar anotações</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SheetThumb({ projectId, sheet }: { projectId: string; sheet: Sheet }) {
  const [url, setUrl] = useState<string | null>(null);
  const isPdf = sheet.mime === "application/pdf";
  useEffect(() => {
    if (isPdf) return;
    let alive = true;
    let made: string | null = null;
    apiObjectUrl(`/production/projects/${projectId}/tech-folder/sheets/${sheet.id}/file`)
      .then((u) => { made = u; if (alive) setUrl(u); else URL.revokeObjectURL(u); })
      .catch(() => undefined);
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [projectId, sheet.id, isPdf]);
  return (
    <div className="flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
      {isPdf ? (
        sheet.drawing ? (
          <div className="text-center text-xs text-muted-foreground"><PencilRuler className="mx-auto mb-1 h-6 w-6" />Desenho por medidas</div>
        ) : (
          <div className="text-center text-xs text-muted-foreground"><FileText className="mx-auto mb-1 h-6 w-6" />PDF · pág. {(sheet.page ?? 0) + 1}</div>
        )
      ) : url ? (
        <img src={url} alt={sheet.title} className="h-full w-full object-contain" />
      ) : (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

/** Pasta técnica do projeto: pranchas do Promob com o carimbo da loja, capa e especificação. */
export function TechFolderPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["tech-folder", projectId];
  const base = `/production/projects/${projectId}/tech-folder`;
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: Folder }>(base) });
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [includeSpecs, setIncludeSpecs] = useState(true);
  const [notes, setNotes] = useState("");
  const [room, setRoom] = useState("");
  const [dirty, setDirty] = useState(false);
  // desenho por medidas: null = fechado; "new" = novo; ou a prancha em edição
  const [drawing, setDrawing] = useState<Sheet | "new" | null>(null);
  const [annotating, setAnnotating] = useState<Sheet | null>(null);
  // precisa ficar aqui em cima, antes de qualquer retorno: hook depois de "return" quebra a tela
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = (d: Folder) => {
    setSheets(d.sheets);
    setIncludeSpecs(d.includeSpecs);
    setNotes(d.notes.join("\n"));
    setDirty(false);
    qc.setQueryData(key, { data: d });
  };
  useEffect(() => {
    const d = q.data?.data;
    if (d && !dirty) { setSheets(d.sheets); setIncludeSpecs(d.includeSpecs); setNotes(d.notes.join("\n")); if (!room && d.rooms[0]) setRoom(d.rooms[0]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const body = () => ({ sheets: sheets.map((s) => ({ id: s.id, room: s.room, title: s.title, scale: s.scale, note: s.note, stamp: s.stamp })), includeSpecs, notes: notes.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 4) });
  const fail = (e: unknown) => toast.error(errorMessage(e, "Não foi possível atualizar a pasta técnica"));
  const save = useMutation({ mutationFn: () => apiPut<{ data: Folder; message?: string }>(base, body()), onSuccess: (r) => { apply(r.data); toast.success(r.message ?? "Pasta técnica salva"); }, onError: fail });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      // salva antes o que estiver editado, para o envio não desfazer títulos e ordem
      if (dirty && sheets.length) await apiPut(base, body());
      let last: Folder | null = null;
      for (const f of files) {
        const form = new FormData();
        form.append("file", f);
        if (room.trim()) form.append("room", room.trim());
        last = (await apiPostForm<{ data: Folder }>(`${base}/sheets`, form)).data;
      }
      return last;
    },
    onSuccess: (d) => { if (d) { apply(d); toast.success("Pranchas adicionadas"); } },
    onError: (e) => { fail(e); qc.invalidateQueries({ queryKey: key }); },
  });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete<{ data: Folder; message?: string }>(`${base}/sheets/${id}`), onSuccess: (r) => { apply(r.data); toast.success(r.message ?? "Prancha removida"); }, onError: fail });
  const openPdf = useMutation({ mutationFn: async () => { if (dirty) apply((await apiPut<{ data: Folder }>(base, body())).data); await apiOpen(`${base}.pdf`); }, onError: fail });
  const publish = useMutation({
    mutationFn: async () => { if (dirty) apply((await apiPut<{ data: Folder }>(base, body())).data); return apiPost<{ message?: string }>(`${base}/publish`, {}); },
    onSuccess: (r) => { toast.success(r.message ?? "Pasta técnica salva nos documentos"); qc.invalidateQueries({ queryKey: ["project", projectId] }); },
    onError: fail,
  });

  if (q.isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const d = q.data?.data;
  if (!d) return <p className="py-6 text-sm text-muted-foreground">Não foi possível carregar a pasta técnica.</p>;

  // Antes estes botões ficavam travados enquanto houvesse título ou ordem sem salvar, e não dava
  // para saber por quê. Agora salvam o que estiver pendente e seguem.
  const afterSave = async (go: (fresh: Sheet[]) => void) => {
    if (!dirty || !sheets.length) return go(sheets);
    setSaving(true);
    try {
      const r = await apiPut<{ data: Folder }>(base, body());
      apply(r.data);
      go(r.data.sheets);
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };
  const edit = (id: string, patch: Partial<Sheet>) => { setSheets((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s))); setDirty(true); };
  const move = (i: number, dir: -1 | 1) => {
    setSheets((cur) => { const next = [...cur]; const j = i + dir; if (j < 0 || j >= next.length) return cur; [next[i], next[j]] = [next[j], next[i]]; return next; });
    setDirty(true);
  };
  const empty = !sheets.length && !(includeSpecs && d.specs.length);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><FolderUp className="h-4 w-4" /> Pasta técnica</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Capa, especificação do orçamento e as pranchas do Promob com o carimbo da loja.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && canManage && <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar</Button>}
          <Button size="sm" variant="outline" disabled={empty || openPdf.isPending} onClick={() => openPdf.mutate()}>{openPdf.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Gerar PDF</Button>
          {canManage && <Button size="sm" disabled={empty || publish.isPending} onClick={() => publish.mutate()}>{publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderUp className="h-4 w-4" />} Salvar nos documentos</Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4" checked={includeSpecs} disabled={!canManage} onChange={(e) => { setIncludeSpecs(e.target.checked); setDirty(true); }} />
            Incluir a folha de especificação
            {d.quote && <Badge variant="secondary">orçamento {d.quote.number}</Badge>}
          </label>
          {d.specs.length ? (
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              {d.specs.map((s) => (
                <div key={s.room} className="rounded-md bg-muted/40 p-2">
                  <p className="font-medium">{s.room}</p>
                  {s.rows.map((r) => <p key={r.label} className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{r.label}:</span> {r.value}</p>)}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Sai sozinha quando o orçamento do projeto tem os acabamentos por ambiente (caixaria, portas, puxador). Este projeto ainda não tem.</p>
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Ambiente das pranchas</Label>
              <Input className="w-56" list={`tf-rooms-${projectId}`} placeholder="Ex.: Varanda" value={room} onChange={(e) => setRoom(e.target.value)} />
              <datalist id={`tf-rooms-${projectId}`}>{d.rooms.map((r) => <option key={r} value={r} />)}</datalist>
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,application/pdf" multiple className="hidden" onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; if (files.length) upload.mutate(files); }} />
            <Button variant="outline" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
              {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Enviar pranchas do Promob
            </Button>
            <Button variant="outline" disabled={saving} title="Digite as medidas e o sistema desenha a vista cotada" onClick={() => void afterSave(() => setDrawing("new"))}>
              <PencilRuler className="h-4 w-4" /> Desenhar por medidas
            </Button>
            <p className="basis-full text-xs text-muted-foreground">Imagens (PNG ou JPG) de planta, vistas e perspectiva recebem o carimbo. PDF exportado do Promob entra página por página.</p>
          </div>
        )}

        {!sheets.length && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma prancha ainda. Exporte as imagens do Promob (planta baixa, vistas, perspectiva) e envie aqui.</p>}
        <div className="space-y-2">
          {sheets.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-start gap-3 rounded-lg border p-2.5">
              <SheetThumb projectId={projectId} sheet={s} />
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1.2fr_1fr_90px]">
                <Input disabled={!canManage} list={`tf-titles-${projectId}`} placeholder="Título (ex.: VISTA A)" value={s.title} onChange={(e) => edit(s.id, { title: e.target.value })} />
                <Input disabled={!canManage} list={`tf-rooms-${projectId}`} placeholder="Ambiente" value={s.room} onChange={(e) => edit(s.id, { room: e.target.value })} />
                <Input disabled={!canManage} list={`tf-scales-${projectId}`} placeholder="Escala" value={s.scale ?? ""} onChange={(e) => edit(s.id, { scale: e.target.value || null })} />
                <Input disabled={!canManage} className="sm:col-span-2" placeholder="Observação em destaque (ex.: P.D: 2656mm)" value={s.note ?? ""} onChange={(e) => edit(s.id, { note: e.target.value || null })} />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Desmarque quando a página do PDF já vem com o carimbo do Promob">
                  <input type="checkbox" className="h-3.5 w-3.5" disabled={!canManage} checked={s.stamp} onChange={(e) => edit(s.id, { stamp: e.target.checked })} /> Carimbo
                </label>
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-0.5">
                  {/* página de PDF que entra sem carimbo vai como veio do Promob: não tem área para anotar */}
                  {(s.stamp || s.mime !== "application/pdf") && (
                    <Button variant={s.annotated ? "secondary" : "ghost"} size="icon" className="h-8 w-8" disabled={saving} onClick={() => void afterSave((fresh) => setAnnotating(fresh.find((x) => x.id === s.id) ?? s))} title={s.annotated ? "Editar anotações" : "Desenhar e escrever na prancha"}><PencilLine className="h-4 w-4" /></Button>
                  )}
                  {s.drawing && <Button variant="ghost" size="icon" className="h-8 w-8" disabled={saving} onClick={() => void afterSave((fresh) => setDrawing(fresh.find((x) => x.id === s.id) ?? s))} title="Editar medidas"><PencilRuler className="h-4 w-4" /></Button>}
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0} onClick={() => move(i, -1)} title="Subir"><ArrowUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === sheets.length - 1} onClick={() => move(i, 1)} title="Descer"><ArrowDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={remove.isPending || saving} onClick={() => void afterSave(() => remove.mutate(s.id))} title="Remover prancha"><Trash2 className="h-4 w-4" /></Button>
                </div>
              )}
            </div>
          ))}
          <datalist id={`tf-titles-${projectId}`}>{d.titles.map((t) => <option key={t} value={t} />)}</datalist>
          <datalist id={`tf-scales-${projectId}`}>{d.scales.map((t) => <option key={t} value={t} />)}</datalist>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Observações da capa (uma por linha, até 4)</Label>
          <Textarea rows={2} disabled={!canManage} placeholder="Ex.: Prateleira e fechamento maiores para galgar in loco." value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
        </div>
      </CardContent>
      <AnnotateDialog base={base} sheet={annotating} aspect={d.area ? d.area.w / d.area.h : 801.92 / 453.32} onClose={() => setAnnotating(null)} onSaved={apply} />
      <TechDrawingDialog<Folder> base={base} open={drawing !== null} onClose={() => setDrawing(null)} onSaved={apply} sheet={drawing && drawing !== "new" ? drawing : null} defaultRoom={room.trim() || d.rooms[0] || ""} aiImage={d.ai?.image} />
    </Card>
  );
}
