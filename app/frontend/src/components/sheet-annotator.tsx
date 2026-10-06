import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Pencil, Redo2, Trash2, Type, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Anotar uma prancha: desenhar à mão e escrever por cima do desenho.
 *
 * O canvas guarda só as anotações (fundo transparente) e tem a mesma proporção
 * da área do desenho na folha — assim o que foi anotado cai no mesmo lugar no
 * PDF. A prancha aparece atrás, só para servir de guia.
 */

const RES_W = 1604;
const MAX_HISTORY = 30;
const COLORS = [
  { value: "#dc2626", label: "Vermelho" },
  { value: "#1a1a1a", label: "Preto" },
  { value: "#2563eb", label: "Azul" },
  { value: "#16a34a", label: "Verde" },
  { value: "#ea580c", label: "Laranja" },
];
const SIZES = [
  { value: 3, font: 22, label: "Fina" },
  { value: 6, font: 32, label: "Média" },
  { value: 12, font: 48, label: "Grossa" },
];

type Tool = "PEN" | "TEXT" | "ERASER";

export function SheetAnnotator({
  backgroundUrl,
  initialOverlayUrl,
  aspect,
  registerGetter,
  onDirtyChange,
}: {
  /** a prancha, para aparecer atrás */
  backgroundUrl: string | null;
  /** anotações já salvas, para continuar */
  initialOverlayUrl?: string | null;
  /** largura / altura da área do desenho na folha */
  aspect: number;
  /** recebe a função que devolve o PNG transparente das anotações (ou null se estiver vazio) */
  registerGetter: (fn: () => string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const RES_H = Math.round(RES_W / aspect);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const history = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);
  const [tool, setTool] = useState<Tool>("PEN");
  const [color, setColor] = useState(COLORS[0].value);
  const [size, setSize] = useState(SIZES[1]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // caixa de texto aberta sobre o desenho (posição em pixels do canvas)
  const [typing, setTyping] = useState<{ x: number; y: number; value: string } | null>(null);

  const ctxOf = () => canvasRef.current?.getContext("2d") ?? null;
  const snapshot = () => ctxOf()?.getImageData(0, 0, RES_W, RES_H) ?? null;
  const sync = () => {
    setCanUndo(history.current.length > 1);
    setCanRedo(redoStack.current.length > 0);
  };
  const pushHistory = useCallback(() => {
    const snap = snapshot();
    if (!snap) return;
    history.current.push(snap);
    if (history.current.length > MAX_HISTORY) history.current.shift();
    redoStack.current = [];
    sync();
    onDirtyChange?.(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDirtyChange, RES_H]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = RES_W;
    canvas.height = RES_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const first = () => {
      history.current = [];
      redoStack.current = [];
      const snap = ctx.getImageData(0, 0, RES_W, RES_H);
      history.current.push(snap);
      sync();
    };
    if (!initialOverlayUrl) return first();
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, RES_W, RES_H);
      first();
    };
    img.onerror = first;
    img.src = initialOverlayUrl;
  }, [initialOverlayUrl, RES_H]);

  // devolve o PNG só se houver algo desenhado
  useEffect(() => {
    registerGetter(() => {
      const snap = snapshot();
      if (!snap) return null;
      const d = snap.data;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return canvasRef.current!.toDataURL("image/png");
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerGetter, RES_H]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * RES_W, y: ((e.clientY - r.top) / r.height) * RES_H };
  };

  const commitText = () => {
    const t = typing;
    setTyping(null);
    const ctx = ctxOf();
    if (!t || !ctx || !t.value.trim()) return;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = color;
    ctx.font = `600 ${size.font}px Helvetica, Arial, sans-serif`;
    ctx.textBaseline = "top";
    t.value.split("\n").forEach((line, i) => ctx.fillText(line, t.x, t.y + i * size.font * 1.2));
    ctx.restore();
    pushHistory();
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "TEXT") {
      if (typing) commitText();
      else setTyping({ ...pos(e), value: "" });
      return;
    }
    const ctx = ctxOf();
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.globalCompositeOperation = tool === "ERASER" ? "destination-out" : "source-over";
    ctx.strokeStyle = color;
    ctx.lineWidth = tool === "ERASER" ? size.value * 5 : size.value;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y + 0.01);
    ctx.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ctxOf();
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    pushHistory();
  };

  const restore = (snap: ImageData | undefined) => {
    const ctx = ctxOf();
    if (ctx && snap) ctx.putImageData(snap, 0, 0);
    sync();
    onDirtyChange?.(true);
  };
  const undo = () => {
    if (history.current.length < 2) return;
    redoStack.current.push(history.current.pop()!);
    restore(history.current[history.current.length - 1]);
  };
  const redo = () => {
    const snap = redoStack.current.pop();
    if (!snap) return;
    history.current.push(snap);
    restore(snap);
  };
  const clear = () => {
    ctxOf()?.clearRect(0, 0, RES_W, RES_H);
    pushHistory();
  };

  const toolBtn = (t: Tool, icon: React.ReactNode, label: string) => (
    <Button type="button" size="sm" variant={tool === t ? "secondary" : "ghost"} onClick={() => { if (typing) commitText(); setTool(t); }}>
      {icon} {label}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {toolBtn("PEN", <Pencil className="mr-2 h-4 w-4" />, "Desenhar")}
          {toolBtn("TEXT", <Type className="mr-2 h-4 w-4" />, "Escrever")}
          {toolBtn("ERASER", <Eraser className="mr-2 h-4 w-4" />, "Borracha")}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {COLORS.map((c) => (
            <button key={c.value} type="button" title={c.label} aria-label={c.label} onClick={() => setColor(c.value)} className={cn("h-7 w-7 rounded-md border-2 transition", color === c.value ? "scale-110 border-foreground" : "border-transparent")} style={{ backgroundColor: c.value }} />
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {SIZES.map((s) => (
            <Button key={s.value} type="button" size="sm" variant={size.value === s.value ? "secondary" : "ghost"} onClick={() => setSize(s)}>{s.label}</Button>
          ))}
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={undo} disabled={!canUndo}><Undo2 className="mr-2 h-4 w-4" /> Desfazer</Button>
        <Button type="button" size="sm" variant="ghost" onClick={redo} disabled={!canRedo}><Redo2 className="mr-2 h-4 w-4" /> Refazer</Button>
        <Button type="button" size="sm" variant="ghost" onClick={clear}><Trash2 className="mr-2 h-4 w-4" /> Limpar</Button>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-border bg-white">
        {backgroundUrl && <img src={backgroundUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain" />}
        <canvas
          ref={canvasRef}
          style={{ touchAction: "none", aspectRatio: `${RES_W} / ${RES_H}` }}
          className={cn("relative block w-full bg-transparent", tool === "TEXT" ? "cursor-text" : "cursor-crosshair")}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
        {typing && (
          <textarea
            autoFocus
            rows={1}
            value={typing.value}
            placeholder="Escreva e aperte Enter"
            onChange={(e) => setTyping({ ...typing, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
              if (e.key === "Escape") setTyping(null);
            }}
            onBlur={commitText}
            className="absolute min-w-[160px] resize-none rounded border border-dashed border-foreground/50 bg-white/85 px-1 py-0.5 font-semibold leading-tight outline-none"
            style={{ left: `${(typing.x / RES_W) * 100}%`, top: `${(typing.y / RES_H) * 100}%`, color, fontSize: Math.max(10, size.font * ((canvasRef.current?.getBoundingClientRect().width ?? RES_W) / RES_W)) }}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Em "Escrever", clique no ponto da prancha, digite e aperte Enter (Shift+Enter quebra a linha). A borracha apaga só as anotações, nunca o desenho.
      </p>
    </div>
  );
}
