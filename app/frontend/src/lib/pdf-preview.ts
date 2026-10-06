/**
 * Página de um PDF virando imagem, no próprio navegador — para mostrar uma
 * prancha em PDF como fundo da tela de anotar. A biblioteca só é baixada
 * quando alguém abre essa tela.
 */
export async function pdfPageToDataUrl(data: ArrayBuffer, pageIndex = 0, maxWidth = 1600): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await doc.getPage(Math.min(pageIndex, doc.numPages - 1) + 1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: maxWidth / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas indisponível");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    void doc.destroy();
  }
}
