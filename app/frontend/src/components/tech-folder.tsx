import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FileDown, FileText, FolderUp, ImagePlus, Loader2, PencilRuler, Save, Trash2 } from "lucide-react";
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

type Sheet = { id: string; room: string; title: string; scale: string | null; note: string | null; fileName: string; mime: string; page: number | null; stamp: boolean; drawing?: DrawingSpec };
type Spec = { room: string; rows: { label: string; value: string }[]; description: string | null };
type Folder = { sheets: Sheet[]; includeSpecs: boolean; notes: string[]; specs: Spec[]; rooms: string[]; quote: { number: string; status: string } | null; titles: string[]; scales: string[] };

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
            <Button variant="outline" disabled={dirty} title={dirty ? "Salve as alterações antes" : "Digite as medidas e o sistema desenha a vista cotada"} onClick={() => setDrawing("new")}>
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
                  {s.drawing && <Button variant="ghost" size="icon" className="h-8 w-8" disabled={dirty} onClick={() => setDrawing(s)} title={dirty ? "Salve as alterações antes de editar" : "Editar medidas"}><PencilRuler className="h-4 w-4" /></Button>}
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0} onClick={() => move(i, -1)} title="Subir"><ArrowUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === sheets.length - 1} onClick={() => move(i, 1)} title="Descer"><ArrowDown className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={remove.isPending || dirty} onClick={() => remove.mutate(s.id)} title={dirty ? "Salve as alterações antes de remover" : "Remover prancha"}><Trash2 className="h-4 w-4" /></Button>
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
      <TechDrawingDialog<Folder> base={base} open={drawing !== null} onClose={() => setDrawing(null)} onSaved={apply} sheet={drawing && drawing !== "new" ? drawing : null} defaultRoom={room.trim() || d.rooms[0] || ""} />
    </Card>
  );
}
