import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, Grid3x3, Redo2, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Prancheta de desenho à mão para a medição — pensada para tablet com caneta.
 *
 * O canvas tem resolução fixa (RES_W x RES_H) e é exibido escalado, então o
 * desenho fica igual em qualquer tela e pode ser reaberto e continuado depois.
 * Pointer events cobrem caneta, dedo e mouse; `touchAction: none` evita a
 * página rolar enquanto se desenha.
 */

const RES_W = 1600;
const RES_H = 1100;
const MAX_HISTORY = 25;

const COLORS = [
  { value: "#1a1a1a", label: "Preto" },
  { value: "#2563eb", label: "Azul" },
  { value: "#dc2626", label: "Vermelho" },
  { value: "#16a34a", label: "Verde" },
  { value: "#ea580c", label: "Laranja" },
];
const SIZES = [
  { value: 2, label: "Fina" },
  { value: 5, label: "Média" },
  { value: 10, label: "Grossa" },
];

export function SketchPad({
  initialImageUrl,
  onDirtyChange,
  registerGetter,
  className,
}: {
  /** Desenho já salvo, para continuar de onde parou. */
  initialImageUrl?: string | null;
  onDirtyChange?: (dirty: boolean) => void;
  /** Recebe a função que devolve o PNG atual (data URL). */
  registerGetter: (fn: () => string | null) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const history = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const [color, setColor] = useState(COLORS[0].value);
  const [size, setSize] = useState(SIZES[1].value);
  const [erasing, setErasing] = useState(false);
  const [grid, setGrid] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const ctxOf = () => canvasRef.current?.getContext("2d") ?? null;

  const markDirty = useCallback(
    (v: boolean) => {
      setDirty(v);
      onDirtyChange?.(v);
    },
    [onDirtyChange]
  );

  /**
   * O canvas fica TRANSPARENTE para a malha (desenhada em CSS atrás dele)
   * aparecer como guia. O fundo branco entra só na hora de exportar o PNG —
   * assim a malha não vai junto no arquivo salvo.
   */
  const clearCanvas = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, RES_W, RES_H);
    ctx.restore();
  }, []);

  /** PNG com fundo branco achatado, pronto para salvar. */
  const exportPng = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const out = document.createElement("canvas");
    out.width = RES_W;
    out.height = RES_H;
    const octx = out.getContext("2d");
    if (!octx) return null;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, RES_W, RES_H);
    octx.drawImage(canvas, 0, 0);
    return out.toDataURL("image/png");
  }, []);

  // Monta o canvas e carrega o desenho existente, quando houver.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = RES_W;
    canvas.height = RES_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    clearCanvas(ctx);

    if (initialImageUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // Encaixa a imagem mantendo a proporção.
        const scale = Math.min(RES_W / img.width, RES_H / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (RES_W - w) / 2, (RES_H - h) / 2, w, h);
        history.current = [canvas.toDataURL("image/png")];
      };
      img.src = initialImageUrl;
    } else {
      history.current = [canvas.toDataURL("image/png")];
    }
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, [initialImageUrl, clearCanvas]);

  useEffect(() => {
    registerGetter(exportPng);
  }, [registerGetter, exportPng]);

  const pushHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    history.current.push(canvas.toDataURL("image/png"));
    if (history.current.length > MAX_HISTORY) history.current.shift();
    redoStack.current = [];
    setCanUndo(history.current.length > 1);
    setCanRedo(false);
  };

  const restore = (dataUrl: string) => {
    const canvas = canvasRef.current;
    const ctx = ctxOf();
    if (!canvas || !ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, RES_W, RES_H);
      ctx.drawImage(img, 0, 0, RES_W, RES_H);
      ctx.restore();
    };
    img.src = dataUrl;
  };

  const undo = () => {
    if (history.current.length <= 1) return;
    const current = history.current.pop()!;
    redoStack.current.push(current);
    restore(history.current[history.current.length - 1]);
    setCanUndo(history.current.length > 1);
    setCanRedo(true);
    markDirty(true);
  };

  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    history.current.push(next);
    restore(next);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
    markDirty(true);
  };

  const clear = () => {
    const ctx = ctxOf();
    if (!ctx) return;
    clearCanvas(ctx);
    pushHistory();
    markDirty(true);
  };

  /** Converte a posição do ponteiro (CSS px) para a resolução do canvas. */
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * RES_W,
      y: ((e.clientY - rect.top) / rect.height) * RES_H,
    };
  };

  const applyBrush = (ctx: CanvasRenderingContext2D, pressure: number) => {
    // Caneta com pressão engrossa o traço; dedo/mouse usam a espessura cheia.
    const factor = pressure > 0 && pressure !== 0.5 ? 0.4 + pressure * 1.2 : 1;
    ctx.lineWidth = erasing ? size * 4 : size * factor;
    // Borracha apaga de verdade (o canvas é transparente), não pinta branco.
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    ctx.strokeStyle = color;
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ctxOf();
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pos(e);
    applyBrush(ctx, e.pressure);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Ponto isolado: um toque sem arrastar precisa marcar.
    ctx.lineTo(x + 0.01, y + 0.01);
    ctx.stroke();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ctxOf();
    if (!ctx) return;
    const { x, y } = pos(e);
    applyBrush(ctx, e.pressure);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirty) markDirty(true);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    pushHistory();
    markDirty(true);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              aria-label={c.label}
              onClick={() => {
                setColor(c.value);
                setErasing(false);
              }}
              className={cn(
                "h-7 w-7 rounded-md border-2 transition",
                color === c.value && !erasing ? "border-foreground scale-110" : "border-transparent"
              )}
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {SIZES.map((s) => (
            <Button
              key={s.value}
              type="button"
              size="sm"
              variant={size === s.value ? "secondary" : "ghost"}
              onClick={() => setSize(s.value)}
            >
              {s.label}
            </Button>
          ))}
        </div>

        <Button type="button" size="sm" variant={erasing ? "secondary" : "ghost"} onClick={() => setErasing((v) => !v)}>
          <Eraser className="mr-2 h-4 w-4" /> Borracha
        </Button>
        <Button type="button" size="sm" variant={grid ? "secondary" : "ghost"} onClick={() => setGrid((v) => !v)}>
          <Grid3x3 className="mr-2 h-4 w-4" /> Malha
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={undo} disabled={!canUndo}>
          <Undo2 className="mr-2 h-4 w-4" /> Desfazer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={redo} disabled={!canRedo}>
          <Redo2 className="mr-2 h-4 w-4" /> Refazer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={clear}>
          <Trash2 className="mr-2 h-4 w-4" /> Limpar
        </Button>
      </div>

      <div
        className="relative overflow-hidden rounded-lg border border-border bg-white"
        style={
          grid
            ? {
                backgroundImage:
                  "linear-gradient(to right, rgba(0,0,0,.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,.07) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }
            : undefined
        }
      >
        <canvas
          ref={canvasRef}
          style={{ touchAction: "none", aspectRatio: `${RES_W} / ${RES_H}` }}
          className="block w-full cursor-crosshair bg-transparent"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Desenhe com a caneta ou o dedo. A malha é só guia visual — não sai no arquivo salvo.
      </p>
    </div>
  );
}
