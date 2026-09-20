import type { Response } from "express";
import type { Readable } from "stream";
import { StorageError } from "./ApiError";

/**
 * Envia um arquivo em streaming para a resposta sem derrubar o processo.
 *
 * `stream.pipe(res)` puro não trata erro: se o storage falhar no meio da
 * leitura, o evento `error` fica sem ouvinte e vira uma exceção não capturada.
 * Aqui:
 * - erro ANTES do primeiro byte -> responde JSON 502 (STORAGE_ERROR);
 * - erro DEPOIS que o download começou -> encerra a conexão (não dá mais para
 *   trocar o status);
 * - cliente cancelou o download -> libera o stream de origem.
 */
export function pipeToResponse(stream: Readable, res: Response): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    stream.once("error", (err) => {
      console.error("[STORAGE_ERROR] falha ao transmitir arquivo:", err);
      if (!res.headersSent) {
        const e = new StorageError();
        res.removeHeader("Content-Disposition");
        res.removeHeader("Content-Type");
        res.status(e.statusCode).json({ success: false, code: e.code, message: e.message });
      } else {
        res.destroy(err);
      }
      done();
    });

    res.once("close", () => {
      if (!stream.destroyed) stream.destroy();
      done();
    });
    res.once("finish", done);

    stream.pipe(res);
  });
}
