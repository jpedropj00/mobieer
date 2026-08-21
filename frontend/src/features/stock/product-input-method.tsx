import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { Camera, CameraOff, Keyboard, Loader2, ScanLine, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { Product } from "@/types";
import { ApiError, apiGet } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductPicker } from "@/features/stock/product-picker";
import { ProductFormDialog } from "@/features/products/product-form-dialog";

export function ProductInputMethod({ onSelect, excludeIds = [] }: { onSelect: (product: Product) => void; excludeIds?: string[] }) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [missingCode, setMissingCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const resultHandledRef = useRef(false);

  const stopCamera = useCallback(() => {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    resultHandledRef.current = false;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const scan = useCallback(async (detectedCode?: string) => {
    const value = (detectedCode ?? code).trim();
    if (value.length < 3) {
      toast.error("Não foi possível identificar a leitura. Tente novamente ou use Digitar produto.");
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    try {
      const result = await apiGet<{ data: Product }>("/products/scan", { code: value });
      onSelect(result.data);
      setCode("");
      stopCamera();
      setScannerOpen(false);
      toast.success(`${result.data.name} identificado`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setMissingCode(value);
      } else {
        toast.error((error as Error).message || "Erro ao consultar o produto");
      }
    } finally {
      setLoading(false);
    }
  }, [code, onSelect, stopCamera]);

  const startCamera = async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Este navegador ou dispositivo não permite abrir a câmera. Verifique se o site está em HTTPS ou use Digitar produto.");
      return;
    }
    setCameraStarting(true);
    try {
      const video = videoRef.current;
      if (!video) throw new Error("Visualização da câmera indisponível");
      resultHandledRef.current = false;
      const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 100 });
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        video,
        (result, _error, activeControls) => {
          const value = result?.getText().trim();
          if (!value || resultHandledRef.current) return;
          resultHandledRef.current = true;
          setCode(value);
          activeControls.stop();
          scannerControlsRef.current = null;
          setCameraActive(false);
          void scan(value);
        },
      );
      if (resultHandledRef.current) {
        controls.stop();
        return;
      }
      scannerControlsRef.current = controls;
      setCameraActive(true);
    } catch (error) {
      stopCamera();
      const errorName = error instanceof DOMException ? error.name : "";
      const denied = errorName === "NotAllowedError" || errorName === "PermissionDeniedError";
      const unavailable = errorName === "NotFoundError" || errorName === "DevicesNotFoundError";
      const busy = errorName === "NotReadableError" || errorName === "TrackStartError";
      setCameraError(
        denied
          ? "Permissão da câmera negada. Autorize o acesso nas configurações do navegador e tente novamente."
          : unavailable
            ? "Nenhuma câmera foi encontrada neste dispositivo."
            : busy
              ? "A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente."
              : "Não foi possível abrir a câmera. Verifique a permissão, use HTTPS e tente novamente.",
      );
    } finally {
      setCameraStarting(false);
    }
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button type="button" variant="outline" className="h-16 justify-start px-4" onClick={() => { setMissingCode(""); setScannerOpen(true); }}>
          <ScanLine className="h-5 w-5" />
          <span className="text-left"><span className="block font-semibold">Escanear produto</span><span className="block text-xs font-normal text-muted-foreground">Código de barras, QR ou SKU</span></span>
        </Button>
        <Button type="button" variant="outline" className="h-16 justify-start px-4" onClick={() => setPickerOpen(true)}>
          <Keyboard className="h-5 w-5" />
          <span className="text-left"><span className="block font-semibold">Digitar produto</span><span className="block text-xs font-normal text-muted-foreground">Pesquise pelo nome ou código</span></span>
        </Button>
      </div>

      <Dialog open={scannerOpen} onOpenChange={(open) => { if (!open) stopCamera(); setScannerOpen(open); }}>
        <DialogContent onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}>
          <DialogHeader><DialogTitle>Escanear produto</DialogTitle><DialogDescription>Use a câmera do celular, um leitor externo ou digite o código.</DialogDescription></DialogHeader>
          <div className="space-y-2">
            <div className={cameraActive ? "relative overflow-hidden rounded-xl bg-black" : "hidden"}>
              <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" />
              <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]" />
              <p className="absolute inset-x-0 bottom-3 text-center text-xs font-medium text-white drop-shadow">Centralize o código dentro da moldura</p>
            </div>
            {!cameraActive && <Button type="button" variant="outline" className="w-full" disabled={cameraStarting} onClick={() => void startCamera()}>{cameraStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}Abrir câmera</Button>}
            {cameraActive && <Button type="button" variant="outline" className="w-full" onClick={stopCamera}><CameraOff className="h-4 w-4" />Fechar câmera</Button>}
            {cameraError && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{cameraError}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="scan-code">Código de barras, QR, SKU ou código interno</Label>
            <Input id="scan-code" ref={inputRef} value={code} onChange={(event) => { setCode(event.target.value); setMissingCode(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void scan(); } }} placeholder="Aguardando leitura..." />
          </div>
          {missingCode && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <div className="flex gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-medium">Produto não localizado no banco</p><p className="mt-1">Código: {missingCode}. Complete o cadastro e ele será adicionado automaticamente a esta movimentação.</p></div></div>
              <Button type="button" size="sm" className="mt-3" onClick={() => { setScannerOpen(false); setCreateOpen(true); }}>Cadastrar produto</Button>
              <Button type="button" size="sm" variant="ghost" className="mt-3" onClick={() => { setScannerOpen(false); setPickerOpen(true); }}>Digitar produto</Button>
            </div>
          )}
          <DialogFooter><Button type="button" variant="outline" onClick={() => { stopCamera(); setScannerOpen(false); }}>Cancelar</Button><Button type="button" disabled={loading} onClick={() => void scan()}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}Identificar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ProductPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={onSelect} excludeIds={excludeIds} />
      <ProductFormDialog open={createOpen} onOpenChange={setCreateOpen} initialBarcode={missingCode} onCreated={(product) => { onSelect(product); setCode(""); setMissingCode(""); toast.success("Produto incluído na movimentação"); }} />
    </>
  );
}
