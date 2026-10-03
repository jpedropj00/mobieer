import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { Camera, CameraOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Leitor de código de barras pela câmera do celular/tablet (o mesmo motor do
 * estoque). Fica aberto lendo uma etiqueta atrás da outra; o mesmo código lido
 * de novo em poucos segundos é ignorado, para não dar baixa duas vezes.
 */
export function CameraScanner({ onCode, disabled, repeatMs = 3000 }: { onCode: (code: string) => void; disabled?: boolean; repeatMs?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const last = useRef<{ code: string; at: number } | null>(null);
  const handler = useRef(onCode);
  handler.current = onCode;
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const stop = useCallback(() => {
    controls.current?.stop();
    controls.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador não permite abrir a câmera. Verifique se o site está em HTTPS ou use o leitor/teclado.");
      return;
    }
    setStarting(true);
    try {
      const video = videoRef.current;
      if (!video) return;
      const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 });
      controls.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        video,
        (result) => {
          const code = result?.getText().trim();
          if (!code) return;
          const now = Date.now();
          if (last.current && last.current.code === code && now - last.current.at < repeatMs) return;
          last.current = { code, at: now };
          handler.current(code);
        },
      );
      setActive(true);
    } catch (e) {
      stop();
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Permissão da câmera negada. Autorize o acesso nas configurações do navegador e tente novamente."
          : name === "NotFoundError" || name === "DevicesNotFoundError"
            ? "Nenhuma câmera foi encontrada neste dispositivo."
            : name === "NotReadableError" || name === "TrackStartError"
              ? "A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente."
              : "Não foi possível abrir a câmera. Verifique a permissão, use HTTPS e tente novamente.",
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className={active ? "relative overflow-hidden rounded-xl bg-black" : "hidden"}>
        <video ref={videoRef} muted playsInline className="aspect-[4/3] max-h-[50vh] w-full object-cover" />
        <div className="pointer-events-none absolute inset-x-[10%] top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]" />
        <p className="absolute inset-x-0 bottom-3 text-center text-xs font-medium text-white drop-shadow">Centralize o código de barras da etiqueta na moldura</p>
      </div>
      {active ? (
        <Button type="button" variant="outline" className="w-full" onClick={stop}>
          <CameraOff className="mr-2 h-4 w-4" /> Fechar câmera
        </Button>
      ) : (
        <Button type="button" variant="outline" className="w-full" disabled={disabled || starting} onClick={() => void start()}>
          {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />} Ler pela câmera
        </Button>
      )}
      {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
