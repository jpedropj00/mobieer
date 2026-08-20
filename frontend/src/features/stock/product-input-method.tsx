import { useCallback, useEffect, useRef, useState } from "react";
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

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorInstance = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

const barcodeFormats = ["aztec", "code_128", "code_39", "code_93", "codabar", "data_matrix", "ean_13", "ean_8", "itf", "pdf417", "qr_code", "upc_a", "upc_e"];

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
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const detectingRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    detectingRef.current = false;
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
    const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("A câmera não está disponível neste navegador. Use Digitar produto.");
      return;
    }
    if (!Detector) {
      setCameraError("Este navegador não oferece leitura automática de códigos. Use Chrome no celular ou Digitar produto.");
      return;
    }
    setCameraStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Visualização da câmera indisponível");
      video.srcObject = stream;
      await video.play();
      setCameraActive(true);
      const detector = new Detector({ formats: barcodeFormats });
      const detectFrame = async () => {
        if (!streamRef.current || detectingRef.current) return;
        detectingRef.current = true;
        try {
          const results = await detector.detect(video);
          const value = results[0]?.rawValue?.trim();
          if (value) {
            setCode(value);
            stopCamera();
            await scan(value);
            return;
          }
        } catch {
          // Alguns frames podem falhar durante o foco automático; a leitura continua.
        } finally {
          detectingRef.current = false;
        }
        if (streamRef.current) frameRef.current = requestAnimationFrame(() => void detectFrame());
      };
      frameRef.current = requestAnimationFrame(() => void detectFrame());
    } catch (error) {
      stopCamera();
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      setCameraError(denied ? "Permissão da câmera negada. Autorize o acesso nas configurações do navegador ou digite o produto." : "Não foi possível abrir a câmera. Verifique se ela não está sendo usada por outro aplicativo.");
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
            {!cameraActive && <Button type="button" variant="outline" className="w-full" disabled={cameraStarting} onClick={() => void startCamera()}>{cameraStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}Abrir câmera do celular</Button>}
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
