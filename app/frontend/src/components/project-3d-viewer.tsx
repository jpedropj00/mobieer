import { useRef, useState } from "react";
import { Box, ExternalLink, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Onde o 3D pode abrir dentro do sistema. A Galeria 3D do Promob aceita ser
 * incorporada; outros sites costumam bloquear, então para eles fica só o link.
 */
const EMBEDDABLE = [/(^|\.)promob\.com$/i];

export function canEmbed3d(url: string | null | undefined) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && EMBEDDABLE.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}

/** Visualizador do 3D do projeto (Galeria 3D do Promob) embutido, com tela cheia. */
export function Project3DViewer({ url, height = "h-[60vh]" }: { url: string; height?: string }) {
  const box = useRef<HTMLDivElement>(null);
  // só carrega o 3D (pesado) quando a pessoa pede
  const [open, setOpen] = useState(false);
  if (!canEmbed3d(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        <Button size="sm" variant="outline"><ExternalLink className="mr-2 h-4 w-4" /> Abrir o 3D</Button>
      </a>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {open && (
          <Button size="sm" variant="outline" onClick={() => void box.current?.requestFullscreen?.().catch(() => undefined)}>
            <Maximize2 className="mr-2 h-4 w-4" /> Tela cheia
          </Button>
        )}
        <a href={url} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="ghost"><ExternalLink className="mr-2 h-4 w-4" /> Abrir em nova aba</Button>
        </a>
        <span className="text-xs text-muted-foreground">Arraste para girar, role para aproximar.</span>
      </div>
      <div ref={box} className={`overflow-hidden rounded-lg border border-border bg-black ${height}`}>
        {open ? (
          <iframe title="Projeto 3D" src={url} className="h-full w-full" allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer" allowFullScreen loading="lazy" />
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/80 hover:text-white">
            <Box className="h-10 w-10" />
            <span className="text-sm">Ver o projeto em 3D</span>
          </button>
        )}
      </div>
    </div>
  );
}
