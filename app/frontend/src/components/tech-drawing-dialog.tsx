import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ImagePlus, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiOpen, apiPost, apiPostForm, apiPut, getToken } from "@/services/api";
import { pdfPageToDataUrl } from "@/lib/pdf-preview";
import { errorMessage } from "@/lib/errors";

type Kind = "PRATELEIRAS" | "PORTAS" | "GAVETAS" | "VAO" | "SAPATEIRA" | "MALEIRO" | "OUTROS";
/** divididas por prateleiras: N divisões dão N + 1 vãos */
const SHELF_LIKE: Kind[] = ["PRATELEIRAS", "SAPATEIRA", "MALEIRO", "OUTROS"];
export type DrawingSpec = {
  description: string;
  width: number;
  height: number;
  depth: number | null;
  top: number;
  base: number;
  sideLeft?: number;
  sideRight?: number;
  columns: { kind: Kind; width: number | null; count: number; heights: number[]; label: string | null; shelves?: number; note?: string | null; parts?: { kind: Kind; count: number; heights: number[]; label: string | null; shelves?: number; height?: number | null }[] }[];
  layout?: "VISTA" | "PRANCHA";
  images?: { closed?: Img | null; open?: Img | null };
  thickness?: number;
  finish?: Finish;
  shelfDepth?: number | null;
  specs?: string[];
};
type Img = { storageKey: string; fileName: string; mime: string };
type Finish = "MADEIRA" | "BRANCO" | "CINZA" | "PRETO";
const FINISH_LABEL: Record<Finish, string> = { MADEIRA: "Madeira", BRANCO: "Branco", CINZA: "Cinza", PRETO: "Preto" };
export type DrawingSheet = { id: string; room: string; title: string; scale: string | null; drawing?: DrawingSpec };

const KIND_LABEL: Record<Kind, string> = { PRATELEIRAS: "Prateleiras", PORTAS: "Portas", GAVETAS: "Gavetas", SAPATEIRA: "Sapateira", MALEIRO: "Maleiro", VAO: "Vão livre", OUTROS: "Outros (escrever)" };
const COUNT_LABEL: Record<Kind, string> = { PRATELEIRAS: "Nº de prateleiras", PORTAS: "Nº de portas", GAVETAS: "Nº de gavetas", VAO: "", SAPATEIRA: "Nº de prateleiras", MALEIRO: "Nº de divisões", OUTROS: "Nº de divisões" };

/** um trecho da coluna, de cima para baixo */
type Part = { kind: Kind; count: string; heights: string; shelves: string; label: string; height: string };
type Col = { width: string; note: string; parts: Part[] };
const newPart = (kind: Kind): Part => ({ kind, count: kind === "PORTAS" ? "2" : kind === "MALEIRO" || kind === "OUTROS" || kind === "VAO" ? "0" : kind === "GAVETAS" ? "4" : "5", heights: "", shelves: "0", label: "", height: "" });
type Form = { room: string; title: string; scale: string; description: string; width: string; height: string; depth: string; top: string; base: string; sideLeft: string; sideRight: string; columns: Col[]; layout: "VISTA" | "PRANCHA"; closed: Img | null; open: Img | null; thickness: string; finish: Finish; shelfDepth: string; specs: string };

const num = (s: string) => Number(s.trim().replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")) || 0;
const show = (n: number | null | undefined) => (n ? String(n).replace(".", ",") : "");
/** "378,5; 378,5; 400" → [378.5, 378.5, 400] */
const heightsOf = (s: string) => s.split(/[;/\n|]+|\s+(?=\d)/).map((p) => num(p)).filter((n) => n > 0);

const emptyForm = (room: string): Form => ({
  room,
  title: "VISTA A",
  scale: "1:20",
  layout: "PRANCHA",
  closed: null,
  open: null,
  thickness: "15,5",
  finish: "MADEIRA",
  shelfDepth: "",
  specs: "",
  description: "",
  width: "",
  height: "",
  depth: "",
  top: "",
  base: "",
  sideLeft: "",
  sideRight: "",
  columns: [{ width: "", note: "", parts: [newPart("PRATELEIRAS")] }],
});

const fromSheet = (s: DrawingSheet): Form => ({
  room: s.room,
  title: s.title,
  scale: s.scale ?? "",
  description: s.drawing!.description,
  width: show(s.drawing!.width),
  height: show(s.drawing!.height),
  depth: show(s.drawing!.depth),
  top: show(s.drawing!.top),
  base: show(s.drawing!.base),
  sideLeft: show(s.drawing!.sideLeft),
  sideRight: show(s.drawing!.sideRight),
  columns: s.drawing!.columns.map((c) => ({
    width: show(c.width),
    note: c.note ?? "",
    // coluna antiga (um tipo só) vira um trecho
    parts: (c.parts?.length ? c.parts : [c]).map((p) => ({ kind: p.kind, count: String(p.count), heights: p.heights.map((h) => show(h)).join("; "), shelves: String(p.shelves ?? 0), label: p.label ?? "", height: show("height" in p ? p.height : null) })),
  })),
  layout: s.drawing!.layout ?? "VISTA",
  closed: s.drawing!.images?.closed ?? null,
  open: s.drawing!.images?.open ?? null,
  thickness: show(s.drawing!.thickness) || "15,5",
  finish: s.drawing!.finish ?? "MADEIRA",
  shelfDepth: show(s.drawing!.shelfDepth),
  specs: (s.drawing!.specs ?? []).join("\n"),
});

/**
 * Desenho por medidas: a pessoa digita largura, altura, topo, rodapé e o que há
 * em cada coluna, e o sistema gera a vista cotada como uma prancha da pasta.
 */
export function TechDrawingDialog<T>({ base, open, onClose, onSaved, sheet, defaultRoom, aiImage }: { base: string; open: boolean; onClose: () => void; onSaved: (data: T) => void; sheet: DrawingSheet | null; defaultRoom: string; /** a IA de imagem está configurada no servidor */ aiImage?: boolean }) {
  const [f, setF] = useState<Form>(emptyForm(defaultRoom));
  useEffect(() => {
    if (open) setF(sheet?.drawing ? fromSheet(sheet) : emptyForm(defaultRoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sheet?.id]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const setCol = (i: number, patch: Partial<Col>) => setF((cur) => ({ ...cur, columns: cur.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const setPart = (i: number, k: number, patch: Partial<Part>) => setF((cur) => ({ ...cur, columns: cur.columns.map((c, j) => (j === i ? { ...c, parts: c.parts.map((p, m) => (m === k ? { ...p, ...patch } : p)) } : c)) }));

  const inner = num(f.height) - num(f.top) - num(f.base);
  const [uploading, setUploading] = useState<"closed" | "open" | null>(null);
  // IA: a vista cotada já salva vira imagem aqui na tela e vai para o servidor, que chama a IA
  const [generating, setGenerating] = useState<"closed" | "open" | null>(null);
  const generate = async (slot: "closed" | "open") => {
    if (!sheet?.drawing) return;
    setGenerating(slot);
    try {
      const file = await fetch(`/api${base}/sheets/${sheet.id}/file`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!file.ok) throw new Error("vista");
      const png = await (await fetch(await pdfPageToDataUrl(await file.arrayBuffer(), 0))).blob();
      const form = new FormData();
      form.append("file", png, "vista.png");
      form.append("slot", slot);
      form.append("view", slot === "open" ? "ABERTO" : "FECHADO");
      const r = await apiPostForm<{ data: T; message?: string }>(`${base}/sheets/${sheet.id}/ai-image`, form);
      toast.success(r.message ?? "Imagem gerada pela IA");
      onSaved(r.data);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível gerar a imagem com a IA"));
    } finally {
      setGenerating(null);
    }
  };
  const sendImage = async (slot: "closed" | "open", file: File) => {
    setUploading(slot);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await apiPostForm<{ data: Img }>(`${base}/drawing-images`, form);
      set(slot, r.data);
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível enviar a imagem"));
    } finally {
      setUploading(null);
    }
  };

  const save = useMutation({
    mutationFn: (view: boolean) => {
      const body = {
        room: f.room.trim(),
        title: f.title.trim(),
        scale: f.scale.trim() || null,
        spec: {
          description: f.description.trim(),
          width: num(f.width),
          height: num(f.height),
          depth: num(f.depth) || null,
          top: num(f.top),
          base: num(f.base),
          sideLeft: num(f.sideLeft) || 0,
          sideRight: num(f.sideRight) || 0,
          columns: f.columns.map((c) => {
            const parts = c.parts.map((p) => ({ kind: p.kind, count: p.kind === "VAO" ? 0 : Math.round(num(p.count)), heights: heightsOf(p.heights), label: p.kind === "OUTROS" ? p.label.trim() || null : null, shelves: p.kind === "PORTAS" ? Math.round(num(p.shelves)) : 0, height: num(p.height) || null }));
            // o primeiro trecho também vai nos campos da coluna, que é como as pranchas antigas estão guardadas
            return { ...parts[0], width: num(c.width) || null, note: c.note.trim() || null, parts };
          }),
          layout: f.layout,
          images: { closed: f.closed, open: f.open },
          thickness: num(f.thickness) || 15.5,
          finish: f.finish,
          shelfDepth: num(f.shelfDepth) || null,
          specs: f.specs.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 10),
        },
      };
      const call = sheet?.drawing ? apiPut<{ data: T & { sheetId: string; warnings: string[] }; message?: string }>(`${base}/drawings/${sheet.id}`, body) : apiPost<{ data: T & { sheetId: string; warnings: string[] }; message?: string }>(`${base}/drawings`, body);
      return call.then((r) => ({ r, view }));
    },
    onSuccess: ({ r, view }) => {
      toast.success(r.message ?? "Desenho salvo");
      for (const w of r.data.warnings ?? []) toast.warning(w, { duration: 12_000 });
      onSaved(r.data);
      // abre a prancha como ela sai na pasta: com o carimbo, o título e a escala
      if (view) void apiOpen(`${base}/sheets/${r.data.sheetId}/preview.pdf`).catch((e) => toast.error(errorMessage(e, "Não foi possível abrir o desenho")));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível gerar o desenho")),
  });

  const ready = f.room.trim() && f.title.trim() && num(f.width) > 0 && num(f.height) > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sheet?.drawing ? "Editar medidas do desenho" : "Desenhar por medidas"}</DialogTitle>
          <DialogDescription>Informe as medidas em milímetros. O sistema desenha a vista cotada, com a imagem 3D ao lado se você enviar, e coloca na pasta técnica com o carimbo.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {(
            <div className="space-y-1">
              <Label className="text-xs">Imagens 3D (PNG ou JPG) — opcional; entram ao lado da vista, na mesma folha</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {([["closed", "Imagem 3D"], ["open", "Segunda imagem 3D"]] as const).map(([slot, label]) => (
                  <div key={slot} className="rounded-lg border p-2.5">
                    <p className="text-xs font-medium">{label}</p>
                    {f[slot] ? (
                      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate">{f[slot]!.fileName}</span>
                        <button type="button" className="shrink-0 underline" onClick={() => set(slot, null)}>remover</button>
                      </div>
                    ) : (
                      <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                        {uploading === slot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Escolher imagem
                        <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={uploading !== null} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void sendImage(slot, file); }} />
                      </label>
                    )}
                    <button
                      type="button"
                      className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!aiImage || !sheet?.drawing || generating !== null}
                      title={!aiImage ? "A IA de imagem ainda não está configurada (falta a chave GEMINI_API_KEY no servidor)" : !sheet?.drawing ? "Salve o desenho primeiro; a IA parte da vista cotada salva" : "A IA gera a perspectiva 3D a partir da vista cotada salva e das medidas"}
                      onClick={() => void generate(slot)}
                    >
                      {generating === slot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Gerar com IA ({slot === "open" ? "aberto" : "fechado"})
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{aiImage ? "Para gerar com IA, salve o desenho primeiro: ela parte da vista cotada salva. " : "Gerar com IA: aguardando a chave da IA de imagem no servidor. "}Sem imagem, a vista ocupa a folha inteira. Perspectiva sozinha em uma folha: envie em "Enviar pranchas do Promob".</p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_90px]">
            <div className="space-y-1"><Label className="text-xs">Ambiente</Label><Input value={f.room} placeholder="Ex.: Suíte master" onChange={(e) => set("room", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Título da prancha</Label><Input value={f.title} onChange={(e) => set("title", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Escala</Label><Input value={f.scale} placeholder="1:20" onChange={(e) => set("scale", e.target.value)} /></div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Descrição do móvel (chamada da primeira coluna, junto com L x A x P)</Label>
            <Input value={f.description} placeholder="Ex.: Armário com caixaria em MDF cinza urban" onChange={(e) => set("description", e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1"><Label className="text-xs">Largura</Label><Input inputMode="decimal" value={f.width} placeholder="1360" onChange={(e) => set("width", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Altura</Label><Input inputMode="decimal" value={f.height} placeholder="2380" onChange={(e) => set("height", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Profundidade</Label><Input inputMode="decimal" value={f.depth} placeholder="550" onChange={(e) => set("depth", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs" title="A faixa de acabamento em cima do móvel">Roda-teto</Label><Input inputMode="decimal" value={f.top} placeholder="50" onChange={(e) => set("top", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Rodapé</Label><Input inputMode="decimal" value={f.base} placeholder="70" onChange={(e) => set("base", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs" title="As prateleiras saem desenhadas e cotadas com essa espessura">Espessura da chapa</Label><Input inputMode="decimal" value={f.thickness} placeholder="15,5" onChange={(e) => set("thickness", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs" title="Tira de acabamento ao lado do móvel (fechamento ou vista)">Fechamento / vista esq.</Label><Input inputMode="decimal" value={f.sideLeft} placeholder="0" onChange={(e) => set("sideLeft", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs" title="Tira de acabamento ao lado do móvel (fechamento ou vista)">Fechamento / vista dir.</Label><Input inputMode="decimal" value={f.sideRight} placeholder="0" onChange={(e) => set("sideRight", e.target.value)} /></div>
          </div>
          {inner > 0 && <p className="text-xs text-muted-foreground">Vão interno (altura menos roda-teto e rodapé): <span className="font-medium text-foreground">{String(Math.round(inner * 10) / 10).replace(".", ",")} mm</span></p>}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Colunas, da esquerda para a direita</Label>
              <Button type="button" size="sm" variant="outline" disabled={f.columns.length >= 8} onClick={() => set("columns", [...f.columns, { width: "", note: "", parts: [newPart("PORTAS")] }])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Coluna
              </Button>
            </div>
            {f.columns.map((c, i) => (
              <div key={i} className="space-y-2 rounded-lg border p-2.5">
                <div className="flex items-end gap-2">
                  <p className="pb-2 text-xs font-medium">Coluna {i + 1}</p>
                  <div className="w-40 space-y-1"><Label className="text-xs">Largura da coluna</Label><Input inputMode="decimal" value={c.width} placeholder="o que sobrar" onChange={(e) => setCol(i, { width: e.target.value })} /></div>
                  <Button type="button" variant="ghost" size="icon" className="ml-auto h-9 w-9" disabled={f.columns.length === 1} title="Remover coluna" onClick={() => set("columns", f.columns.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
                {i > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs">Chamada desta coluna (opcional) — sai ao lado do móvel, com a linha apontando para ela</Label>
                    <Input value={c.note} placeholder="Ex.: Portas de giro em alumínio prata e espelho prata L 1180 x A 2349 x P 360" onChange={(e) => setCol(i, { note: e.target.value })} />
                  </div>
                )}

                {c.parts.length > 1 && <p className="text-xs text-muted-foreground">O que tem nesta coluna, de cima para baixo. Entre um e outro o sistema põe uma chapa.</p>}
                {c.parts.map((part, k) => {
                  const n = Math.max(0, Math.round(num(part.count)));
                  const shelfLike = SHELF_LIKE.includes(part.kind);
                  return (
                    <div key={k} className={c.parts.length > 1 ? "space-y-2 rounded-md bg-muted/40 p-2" : "space-y-2"}>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
                        <div className="space-y-1">
                          <Label className="text-xs">O que tem</Label>
                          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={part.kind} onChange={(e) => { const kind = e.target.value as Kind; setPart(i, k, { kind, ...(kind === "MALEIRO" || kind === "OUTROS" ? { count: "0" } : {}) }); }}>
                            {(Object.keys(KIND_LABEL) as Kind[]).map((x) => <option key={x} value={x}>{KIND_LABEL[x]}</option>)}
                          </select>
                        </div>
                        {part.kind !== "VAO" ? (
                          <div className="space-y-1"><Label className="text-xs">{COUNT_LABEL[part.kind]}</Label><Input inputMode="numeric" value={part.count} onChange={(e) => setPart(i, k, { count: e.target.value })} /></div>
                        ) : <div />}
                        {c.parts.length > 1 ? (
                          <div className="space-y-1"><Label className="text-xs">Altura deste trecho</Label><Input inputMode="decimal" value={part.height} placeholder="o que sobrar" onChange={(e) => setPart(i, k, { height: e.target.value })} /></div>
                        ) : <div />}
                        {c.parts.length > 1 ? (
                          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 self-end" title="Tirar este trecho" onClick={() => setCol(i, { parts: c.parts.filter((_, m) => m !== k) })}><Trash2 className="h-4 w-4" /></Button>
                        ) : <div />}
                      </div>
                      {part.kind === "OUTROS" && (
                        <div className="space-y-1">
                          <Label className="text-xs">O que é (sai escrito dentro da coluna)</Label>
                          <Input value={part.label} maxLength={24} placeholder="Ex.: Cabideiro, Nicho, Adega" onChange={(e) => setPart(i, k, { label: e.target.value })} />
                        </div>
                      )}
                      {part.kind === "PORTAS" && (
                        <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
                          <div className="space-y-1"><Label className="text-xs">Prateleiras atrás das portas</Label><Input inputMode="numeric" value={part.shelves} onChange={(e) => setPart(i, k, { shelves: e.target.value })} /></div>
                          {Math.round(num(part.shelves)) > 0 && (
                            <div className="space-y-1"><Label className="text-xs">Alturas dos vãos, de cima para baixo</Label><Input value={part.heights} placeholder="em branco divide por igual" onChange={(e) => setPart(i, k, { heights: e.target.value })} /></div>
                          )}
                        </div>
                      )}
                      {(shelfLike || part.kind === "GAVETAS") && (part.kind === "PRATELEIRAS" || part.kind === "SAPATEIRA" || part.kind === "GAVETAS" || n > 0) && (
                        <div className="space-y-1">
                          <Label className="text-xs">{part.kind === "GAVETAS" ? "Alturas das gavetas, de cima para baixo" : "Alturas dos vãos, de cima para baixo"} (separadas por ponto e vírgula)</Label>
                          <Input value={part.heights} placeholder="Ex.: 320; 380; 320 — em branco divide por igual" onChange={(e) => setPart(i, k, { heights: e.target.value })} />
                          <p className="text-xs text-muted-foreground">
                            {part.kind !== "GAVETAS" ? `${n + 1} vãos para ${n} ${part.kind === "PRATELEIRAS" || part.kind === "SAPATEIRA" ? "prateleiras" : "divisões"}.` : `${n} alturas.`} São os vãos livres: a espessura das prateleiras o sistema desconta e cota sozinho. Se a soma for menor que o espaço, o vão de baixo fica com a sobra.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
                <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={c.parts.length >= 6} onClick={() => setCol(i, { parts: [...c.parts, newPart("GAVETAS")] })}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Mais uma coisa nesta coluna (ex.: gavetas embaixo das prateleiras)
                </Button>
              </div>
            ))}
          </div>

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="outline" disabled={!ready || save.isPending} onClick={() => save.mutate(false)}>Salvar</Button>
          <Button disabled={!ready || save.isPending} onClick={() => save.mutate(true)}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar e ver o desenho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
