import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiOpen, apiPost, apiPut } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Kind = "PRATELEIRAS" | "PORTAS" | "GAVETAS" | "VAO";
export type DrawingSpec = {
  description: string;
  width: number;
  height: number;
  depth: number | null;
  top: number;
  base: number;
  columns: { kind: Kind; width: number | null; count: number; heights: number[]; label: string | null; shelves?: number }[];
  layout?: "VISTA" | "PRANCHA";
  thickness?: number;
  finish?: Finish;
  shelfDepth?: number | null;
  specs?: string[];
};
type Finish = "MADEIRA" | "BRANCO" | "CINZA" | "PRETO";
const FINISH_LABEL: Record<Finish, string> = { MADEIRA: "Madeira", BRANCO: "Branco", CINZA: "Cinza", PRETO: "Preto" };
export type DrawingSheet = { id: string; room: string; title: string; scale: string | null; drawing?: DrawingSpec };

const KIND_LABEL: Record<Kind, string> = { PRATELEIRAS: "Prateleiras", PORTAS: "Portas", GAVETAS: "Gavetas", VAO: "Vão livre" };
const COUNT_LABEL: Record<Kind, string> = { PRATELEIRAS: "Nº de prateleiras", PORTAS: "Nº de portas", GAVETAS: "Nº de gavetas", VAO: "" };

type Col = { kind: Kind; width: string; count: string; heights: string; shelves: string };
type Form = { room: string; title: string; scale: string; description: string; width: string; height: string; depth: string; top: string; base: string; columns: Col[]; layout: "VISTA" | "PRANCHA"; thickness: string; finish: Finish; shelfDepth: string; specs: string };

const num = (s: string) => Number(s.trim().replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")) || 0;
const show = (n: number | null | undefined) => (n ? String(n).replace(".", ",") : "");
/** "378,5; 378,5; 400" → [378.5, 378.5, 400] */
const heightsOf = (s: string) => s.split(/[;/\n|]+|\s+(?=\d)/).map((p) => num(p)).filter((n) => n > 0);

const emptyForm = (room: string): Form => ({
  room,
  title: "VISTA A INTERNA",
  scale: "1:10",
  layout: "VISTA",
  thickness: "15",
  finish: "MADEIRA",
  shelfDepth: "",
  specs: "",
  description: "",
  width: "",
  height: "",
  depth: "",
  top: "",
  base: "",
  columns: [{ kind: "PORTAS", width: "", count: "2", heights: "", shelves: "1" }],
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
  columns: s.drawing!.columns.map((c) => ({ kind: c.kind, width: show(c.width), count: String(c.count), heights: c.heights.map((h) => show(h)).join("; "), shelves: String(c.shelves ?? 0) })),
  layout: s.drawing!.layout ?? "VISTA",
  thickness: show(s.drawing!.thickness) || "15",
  finish: s.drawing!.finish ?? "MADEIRA",
  shelfDepth: show(s.drawing!.shelfDepth),
  specs: (s.drawing!.specs ?? []).join("\n"),
});

/**
 * Desenho por medidas: a pessoa digita largura, altura, topo, rodapé e o que há
 * em cada coluna, e o sistema gera a vista cotada como uma prancha da pasta.
 */
export function TechDrawingDialog<T>({ base, open, onClose, onSaved, sheet, defaultRoom }: { base: string; open: boolean; onClose: () => void; onSaved: (data: T) => void; sheet: DrawingSheet | null; defaultRoom: string }) {
  const [f, setF] = useState<Form>(emptyForm(defaultRoom));
  useEffect(() => {
    if (open) setF(sheet?.drawing ? fromSheet(sheet) : emptyForm(defaultRoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sheet?.id]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const setCol = (i: number, patch: Partial<Col>) => setF((cur) => ({ ...cur, columns: cur.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  const inner = num(f.height) - num(f.top) - num(f.base);

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
          columns: f.columns.map((c) => ({ kind: c.kind, width: num(c.width) || null, count: c.kind === "VAO" ? 0 : Math.round(num(c.count)), heights: heightsOf(c.heights), label: null, shelves: c.kind === "PORTAS" ? Math.round(num(c.shelves)) : 0 })),
          layout: "VISTA" as const,
          thickness: num(f.thickness) || 15,
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
      if (view) void apiOpen(`${base}/sheets/${r.data.sheetId}/file`).catch((e) => toast.error(errorMessage(e, "Não foi possível abrir o desenho")));
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
          <DialogDescription>Informe as medidas em milímetros. O sistema guarda as medidas e desenha a vista frontal cotada como uma prancha da pasta técnica.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_90px]">
            <div className="space-y-1"><Label className="text-xs">Ambiente</Label><Input value={f.room} placeholder="Ex.: Suíte master" onChange={(e) => set("room", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Título da prancha</Label><Input value={f.title} onChange={(e) => set("title", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Escala</Label><Input value={f.scale} placeholder="1:20" onChange={(e) => set("scale", e.target.value)} /></div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Descrição do móvel (sai na chamada, junto com L x A x P)</Label>
            <Input value={f.description} placeholder="Ex.: Armário com caixaria em MDF cinza urban" onChange={(e) => set("description", e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="space-y-1"><Label className="text-xs">Largura</Label><Input inputMode="decimal" value={f.width} placeholder="1360" onChange={(e) => set("width", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Altura</Label><Input inputMode="decimal" value={f.height} placeholder="2380" onChange={(e) => set("height", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Profundidade</Label><Input inputMode="decimal" value={f.depth} placeholder="550" onChange={(e) => set("depth", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Topo</Label><Input inputMode="decimal" value={f.top} placeholder="50" onChange={(e) => set("top", e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Rodapé</Label><Input inputMode="decimal" value={f.base} placeholder="70" onChange={(e) => set("base", e.target.value)} /></div>
          </div>
          {(
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label className="text-xs">Espessura das chapas</Label><Input inputMode="decimal" value={f.thickness} placeholder="15" onChange={(e) => set("thickness", e.target.value)} /></div>
              <div className="space-y-1">
                <Label className="text-xs">Cor do móvel</Label>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.finish} onChange={(e) => set("finish", e.target.value as Finish)}>
                  {(Object.keys(FINISH_LABEL) as Finish[]).map((k) => <option key={k} value={k}>{FINISH_LABEL[k]}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Profundidade da prateleira</Label><Input inputMode="decimal" value={f.shelfDepth} placeholder="opcional" onChange={(e) => set("shelfDepth", e.target.value)} /></div>
            </div>
          )}
          {inner > 0 && <p className="text-xs text-muted-foreground">Vão interno (altura menos topo e rodapé): <span className="font-medium text-foreground">{String(Math.round(inner * 10) / 10).replace(".", ",")} mm</span></p>}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Colunas, da esquerda para a direita</Label>
              <Button type="button" size="sm" variant="outline" disabled={f.columns.length >= 8} onClick={() => set("columns", [...f.columns, { kind: "PORTAS", width: "", count: "2", heights: "", shelves: "0" }])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Coluna
              </Button>
            </div>
            {f.columns.map((c, i) => (
              <div key={i} className="space-y-2 rounded-lg border p-2.5">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.1fr_1fr_1fr_auto]">
                  <div className="space-y-1">
                    <Label className="text-xs">O que tem</Label>
                    <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={c.kind} onChange={(e) => setCol(i, { kind: e.target.value as Kind })}>
                      {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Largura da coluna</Label><Input inputMode="decimal" value={c.width} placeholder="o que sobrar" onChange={(e) => setCol(i, { width: e.target.value })} /></div>
                  {c.kind !== "VAO" ? (
                    <div className="space-y-1"><Label className="text-xs">{COUNT_LABEL[c.kind]}</Label><Input inputMode="numeric" value={c.count} onChange={(e) => setCol(i, { count: e.target.value })} /></div>
                  ) : <div />}
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 self-end" disabled={f.columns.length === 1} title="Remover coluna" onClick={() => set("columns", f.columns.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
                {c.kind === "PORTAS" && (
                  <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
                    <div className="space-y-1"><Label className="text-xs">Prateleiras atrás das portas</Label><Input inputMode="numeric" value={c.shelves} onChange={(e) => setCol(i, { shelves: e.target.value })} /></div>
                    {Math.round(num(c.shelves)) > 0 && (
                      <div className="space-y-1"><Label className="text-xs">Alturas dos vãos, de cima para baixo</Label><Input value={c.heights} placeholder="em branco divide por igual" onChange={(e) => setCol(i, { heights: e.target.value })} /></div>
                    )}
                  </div>
                )}
                {(c.kind === "PRATELEIRAS" || c.kind === "GAVETAS") && (
                  <div className="space-y-1">
                    <Label className="text-xs">{c.kind === "PRATELEIRAS" ? "Alturas dos vãos, de cima para baixo" : "Alturas das gavetas, de cima para baixo"} (separadas por ponto e vírgula)</Label>
                    <Input value={c.heights} placeholder="Ex.: 378,5; 378,5; 378,5 — em branco divide por igual" onChange={(e) => setCol(i, { heights: e.target.value })} />
                    <p className="text-xs text-muted-foreground">
                      {c.kind === "PRATELEIRAS" ? `${Math.max(0, Math.round(num(c.count))) + 1} vãos para ${Math.max(0, Math.round(num(c.count)))} prateleiras.` : `${Math.max(0, Math.round(num(c.count)))} alturas.`} Se faltar a última, ela fica com o que sobrar.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {(
            <div className="space-y-1">
              <Label className="text-xs">Especificações do móvel (uma por linha) — ficam guardadas com as medidas</Label>
              <Textarea rows={4} value={f.specs} placeholder={"Ex.: MDF Carvalho Treviso 15mm\nInterno em MDF Branco\nPuxador fornecido pelo cliente"} onChange={(e) => set("specs", e.target.value)} />
            </div>
          )}
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
