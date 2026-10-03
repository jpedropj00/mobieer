/**
 * Geração de imagem para o Render com IA. Hoje só o Gemini gera imagem a
 * partir de outra imagem; o provedor de texto compatível com a OpenAI (Groq)
 * não tem esse recurso. Modelo em GEMINI_IMAGE_MODEL.
 */
import { ApiError, GoogleGenAI } from "@google/genai";
import { env } from "../../../config/env";
import { AiProviderError } from "./types";

export type ImageInput = { bytes: Buffer; mime: string; prompt: string };
export type ImageOutput = { bytes: Buffer; mime: string };

export interface ImageProvider {
  readonly enabled: boolean;
  render(input: ImageInput): Promise<ImageOutput>;
}

let client: GoogleGenAI | null = null;

export function imageProvider(): ImageProvider {
  const cfg = env.assistant;
  const enabled = Boolean(cfg.apiKey);
  return {
    enabled,
    async render(input) {
      if (!enabled) throw new AiProviderError("Render com IA não configurado (defina GEMINI_API_KEY)");
      // o render demora mais que uma resposta de texto
      client ??= new GoogleGenAI({ apiKey: cfg.apiKey, httpOptions: { timeout: cfg.imageTimeoutMs } });
      try {
        const res = await client.models.generateContent({
          model: cfg.imageModel,
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: input.mime, data: input.bytes.toString("base64") } }, { text: input.prompt }] }],
          config: { responseModalities: ["IMAGE"] },
        });
        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (!part?.inlineData?.data) throw new AiProviderError("a IA não devolveu imagem (o pedido pode ter sido recusado pelo filtro do modelo)");
        return { bytes: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType || "image/png" };
      } catch (e) {
        if (e instanceof AiProviderError) throw e;
        if (e instanceof ApiError) throw new AiProviderError(`Gemini respondeu HTTP ${e.status}`, e.status === 429 || e.status >= 500, e.status, String(e.message).slice(0, 300));
        if (e instanceof Error && (e.name === "AbortError" || /timeout|timed out/i.test(e.message))) throw new AiProviderError("tempo limite do render excedido", true);
        throw new AiProviderError("falha de comunicação com o Gemini", true);
      }
    },
  };
}
