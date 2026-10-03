import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FolderUp, ImagePlus, Loader2, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiDownload, apiGet, apiObjectUrl, apiPost, apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Lighting = "DIA" | "NOITE" | "ESTUDIO";
type Render = { id: string; room: string; finishes: string; lighting: Lighting; adjustment: string | null; parentId: string | null; createdAt: string; createdBy: string };
type Data = { enabled: boolean; renders: Render[]; rooms: { room: string; finishes: string }[]; lighting: Record<Lighting, string> };

function RenderImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    apiObjectUrl(path)
      .then((u) => { made = u; if (alive) setUrl(u); else URL.revokeObjectURL(u); })
      .catch(() => undefined);
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [path]);
  return (
    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border bg-muted/40">
      {url ? <a href={url} target="_blank" rel="noreferrer" className="h-full w-full"><img src={url} alt={alt} className="h-full w-full object-contain" /></a> : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

/** Render com IA: a imagem do Promob vira um render com os acabamentos do projeto. */
export function AiRenderPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ["renders", projectId];
  const base = `/production/projects/${projectId}/renders`;
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ data: Data }>(base) });
  const d = q.data?.data;

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [room, setRoom] = useState("");
  const [finishes, setFinishes] = useState("");
  const [lighting, setLighting] = useState<Lighting>("DIA");
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustment, setAdjustment] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // primeiro ambiente do orçamento já vem com os acabamentos dele
  useEffect(() => {
    if (d && !room && d.rooms[0]) { setRoom(d.rooms[0].room); setFinishes(d.rooms[0].finishes); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const pickRoom = (value: string) => {
    setRoom(value);
    const known = d?.rooms.find((r) => r.room.toLowerCase() === value.trim().toLowerCase());
    if (known && (!finishes.trim() || d?.rooms.some((r) => r.finishes === finishes))) setFinishes(known.finishes);
  };

  const fail = (e: unknown) => toast.error(errorMessage(e, "Não foi possível gerar o render"));
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const generate = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("file", file!);
      form.append("room", room.trim());
      form.append("finishes", finishes.trim());
      form.append("lighting", lighting);
      return apiPostForm<{ message?: string }>(base, form);
    },
    onSuccess: (r) => { toast.success(r.message ?? "Render gerado"); setFile(null); refresh(); },
    onError: fail,
  });
  const adjust = useMutation({
    mutationFn: (r: Render) => {
      const form = new FormData();
      form.append("parentId", r.id);
      form.append("room", r.room);
      form.append("finishes", r.finishes);
      form.append("lighting", r.lighting);
      form.append("adjustment", adjustment.trim());
      return apiPostForm<{ message?: string }>(base, form);
    },
    onSuccess: () => { toast.success("Ajuste gerado"); setAdjusting(null); setAdjustment(""); refresh(); },
    onError: fail,
  });
  const publish = useMutation({
    mutationFn: ({ id, visibleToClient }: { id: string; visibleToClient: boolean }) => apiPost<{ message?: string }>(`${base}/${id}/publish`, { visibleToClient }),
    onSuccess: (r) => { toast.success(r.message ?? "Render salvo nos documentos"); qc.invalidateQueries({ queryKey: ["project", projectId] }); },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível salvar nos documentos")),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`${base}/${id}`), onSuccess: () => { toast.success("Render removido"); refresh(); }, onError: (e) => toast.error(errorMessage(e, "Não foi possível remover")) });

  if (q.isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!d) return <p className="py-6 text-sm text-muted-foreground">Não foi possível carregar os renders.</p>;
  const busy = generate.isPending || adjust.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> Render com IA</CardTitle>
          <p className="text-sm text-muted-foreground">Envie a imagem do ambiente exportada do Promob. A IA devolve um render realista com os acabamentos do projeto, sem mudar os móveis.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!d.enabled && (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">O render com IA ainda não está configurado neste ambiente: falta a chave do Gemini (GEMINI_API_KEY) no servidor. A chave atual do assistente não gera imagem.</p>
          )}
          {canManage && (
            <div className="grid gap-4 md:grid-cols-[260px_1fr]">
              <div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                <button type="button" onClick={() => fileRef.current?.click()} className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted/30 text-sm text-muted-foreground hover:bg-muted/60">
                  {preview ? <img src={preview} alt="Imagem do Promob" className="h-full w-full object-contain" /> : <span className="flex flex-col items-center gap-2"><ImagePlus className="h-6 w-6" /> Escolher imagem do Promob</span>}
                </button>
              </div>
              <div className="grid content-start gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Ambiente</Label>
                  <Input list={`render-rooms-${projectId}`} placeholder="Ex.: Varanda" value={room} onChange={(e) => pickRoom(e.target.value)} />
                  <datalist id={`render-rooms-${projectId}`}>{d.rooms.map((r) => <option key={r.room} value={r.room} />)}</datalist>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Iluminação</Label>
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={lighting} onChange={(e) => setLighting(e.target.value as Lighting)}>
                    {(Object.keys(d.lighting) as Lighting[]).map((k) => <option key={k} value={k}>{d.lighting[k]}</option>)}
                  </select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Acabamentos (vêm do orçamento; ajuste se precisar)</Label>
                  <Textarea rows={3} maxLength={1200} placeholder="Ex.: Caixaria em MDF Branco TX. Portas provençal em MDF Areia. Puxador Creta dourado. Bancada em quartzo branco." value={finishes} onChange={(e) => setFinishes(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <Button disabled={!d.enabled || !file || !room.trim() || busy} onClick={() => generate.mutate()}>
                    {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {generate.isPending ? "Gerando (pode levar até 1 minuto)…" : "Gerar render"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!d.renders.length && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhum render gerado ainda neste projeto.</p>}
      {d.renders.map((r) => (
        <Card key={r.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{r.room}</p>
                <Badge variant="secondary">{d.lighting[r.lighting]}</Badge>
                {r.parentId && <Badge variant="outline">Ajuste</Badge>}
                <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("pt-BR")} · {r.createdBy}</span>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => apiDownload(`${base}/${r.id}/result`, `render-${r.room}.png`).catch((e) => toast.error(errorMessage(e, "Não foi possível baixar")))}><Download className="h-4 w-4" /> Baixar</Button>
                {canManage && <Button variant="ghost" size="sm" disabled={publish.isPending} onClick={() => publish.mutate({ id: r.id, visibleToClient: false })}><FolderUp className="h-4 w-4" /> Salvar nos documentos</Button>}
                {canManage && <Button variant="ghost" size="icon" className="h-8 w-8" disabled={remove.isPending} onClick={() => remove.mutate(r.id)} title="Remover"><Trash2 className="h-4 w-4" /></Button>}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="mb-1 text-xs text-muted-foreground">{r.parentId ? "Versão anterior" : "Imagem do Promob"}</p><RenderImage path={`${base}/${r.id}/source`} alt="Imagem de origem" /></div>
              <div><p className="mb-1 text-xs text-muted-foreground">Render</p><RenderImage path={`${base}/${r.id}/result`} alt={`Render — ${r.room}`} /></div>
            </div>
            {r.adjustment && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Ajuste pedido:</span> {r.adjustment}</p>}
            {r.finishes && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Acabamentos:</span> {r.finishes}</p>}
            {canManage && d.enabled && (adjusting === r.id ? (
              <div className="flex flex-wrap items-end gap-2">
                <Textarea rows={2} maxLength={600} className="min-w-[240px] flex-1" placeholder="O que ajustar neste render? Ex.: trocar o puxador para preto fosco e deixar a bancada mais clara." value={adjustment} onChange={(e) => setAdjustment(e.target.value)} />
                <Button disabled={!adjustment.trim() || busy} onClick={() => adjust.mutate(r)}>{adjust.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Gerar ajuste</Button>
                <Button variant="ghost" onClick={() => { setAdjusting(null); setAdjustment(""); }}>Cancelar</Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => { setAdjusting(r.id); setAdjustment(""); }}><Wand2 className="h-4 w-4" /> Ajustar este render</Button>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
