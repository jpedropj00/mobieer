/**
 * Mobieer AI — assistente da equipe da loja: /api/ai
 *
 *   GET  /status              se está configurado e se a documentação está indexada
 *   POST /chat                { message, conversationId? } → { answer, sources, tools_used, conversationId }
 *   POST /render              imagem do Promob + instruções → render (imagem em base64)
 *   GET  /conversations/:id   mensagens de uma conversa do próprio usuário
 *
 * A identidade vem sempre do token (authenticate). O portal do cliente usa
 * outro login e não chega aqui.
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { uploadDocument } from "../../middlewares/upload";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError, BadRequestError } from "../../utils/ApiError";
import { hitLimit, type RateStore } from "../../utils/rate-limit";
import { ok } from "../../utils/response";
import { env } from "../../config/env";
import { MAX_MESSAGE_CHARS } from "./assistant.rules";
import { chat, conversationMessages, recordRender } from "./assistant.service";
import { imageProvider } from "./provider/image";
import { renderPrompt } from "../render/render.rules";
import { AiProviderError, aiProvider } from "./provider";
import { knowledgeStats } from "./rag/rag.service";
import type { ToolUser } from "./tools";

const router = Router();
router.use(authenticate);

/** Por usuário (não por IP): 15 perguntas por minuto e 150 por hora. */
const LIMITS = [
  { name: "min", windowMs: 60_000, max: 15 },
  { name: "hora", windowMs: 60 * 60_000, max: 150 },
];
const stores: RateStore[] = LIMITS.map(() => new Map());

function checkLimit(userId: string) {
  for (const [i, l] of LIMITS.entries()) {
    const r = hitLimit(stores[i], `ai:${userId}`, l);
    if (!r.allowed) throw new ApiError(429, `Muitas perguntas em pouco tempo. Tente de novo em ${r.retryAfterSec < 90 ? `${r.retryAfterSec} segundos` : `${Math.ceil(r.retryAfterSec / 60)} minutos`}.`, undefined, "RATE_LIMITED");
  }
}

const toolUser = (u: Express.Request["user"]): ToolUser => ({ id: u!.id, organizationId: u!.organizationId, permissions: u!.permissions, name: u!.name, email: u!.email, roleLabel: u!.roleLabel, sector: u!.sector });

router.get(
  "/status",
  asyncHandler(async (req, res) => {
    const provider = aiProvider();
    const enabled = provider.enabled;
    const knowledge = enabled ? await knowledgeStats().catch(() => ({ documents: 0, chunks: 0 })) : { documents: 0, chunks: 0 };
    const base = { enabled, knowledge, render: imageProvider().enabled };
    // o diagnóstico (qual provedor, qual modelo, por que falhou) é só para quem administra
    if (!req.user!.permissions.includes("settings.manage")) return ok(res, base);
    const gemini = provider.name === "gemini";
    const diagnosis: Record<string, unknown> = {
      provider: gemini ? "Gemini" : env.ai.providerName,
      model: gemini ? env.assistant.model : env.ai.model,
      missing: enabled ? null : "Nenhuma chave de IA no servidor: defina AI_API_KEY (ou GEMINI_API_KEY) nas variáveis de ambiente do backend e publique de novo.",
      endpointAdjusted: !gemini && env.ai.endpointAdjusted,
    };
    // ?check=1 faz uma chamada mínima ao provedor para dizer se a chave e o modelo funcionam
    if (enabled && req.query.check === "1") {
      const started = Date.now();
      try {
        await provider.run({ system: "Responda apenas com a palavra OK.", history: [], message: "teste de conexão", tools: [], executeTool: async () => null });
        diagnosis.check = { ok: true, ms: Date.now() - started };
      } catch (e) {
        const err = e as AiProviderError;
        diagnosis.check = { ok: false, ms: Date.now() - started, status: err.status ?? null, reason: err.detail || err.message };
      }
    }
    return ok(res, { ...base, diagnosis });
  })
);

const chatInput = z.object({
  message: z.string().trim().min(1, "Escreva a sua pergunta").max(MAX_MESSAGE_CHARS, `A pergunta pode ter até ${MAX_MESSAGE_CHARS} caracteres`),
  conversationId: z.string().min(1).max(40).optional(),
});

router.post(
  "/chat",
  asyncHandler(async (req, res) => {
    if (!aiProvider().enabled) throw new ApiError(503, "O Mobieer AI ainda não está configurado.", undefined, "SERVICE_UNAVAILABLE");
    const input = chatInput.parse(req.body);
    checkLimit(req.user!.id);
    try {
      return ok(res, await chat(toolUser(req.user), input));
    } catch (e) {
      if (e instanceof AiProviderError) {
        console.warn("[mobieer-ai] provider error", JSON.stringify({ status: e.status ?? null, retryable: e.retryable, detail: e.detail ?? null }));
        throw new ApiError(e.status === 429 ? 429 : 502, e.status === 429 ? "O assistente está com muitas solicitações agora. Tente de novo em instantes." : "Não consegui falar com o assistente agora. Tente de novo em instantes.", undefined, e.status === 429 ? "RATE_LIMITED" : "EXTERNAL_SERVICE_ERROR");
      }
      throw e;
    }
  })
);

/** Render pelo chat: cada um custa uma chamada paga de geração de imagem. */
const RENDER_LIMIT = { windowMs: 60 * 60_000, max: 20 };
const renderStore: RateStore = new Map();
const renderInput = z.object({
  message: z.string().trim().max(1200).default(""),
  lighting: z.enum(["DIA", "NOITE", "ESTUDIO"]).default("DIA"),
  // a base é um render anterior: o texto é um ajuste sobre ele
  adjust: z.enum(["true", "false"]).default("false"),
  conversationId: z.string().min(1).max(40).optional(),
});

router.post(
  "/render",
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    if (!imageProvider().enabled) throw new ApiError(503, "O render com IA ainda não está configurado: falta a chave do Gemini no servidor.", undefined, "SERVICE_UNAVAILABLE");
    if (!req.file) throw new BadRequestError("Anexe a imagem do ambiente.");
    if (!/^image\/(png|jpe?g|webp)$/i.test(req.file.mimetype)) throw new BadRequestError("Envie uma imagem PNG, JPG ou WEBP.");
    const input = renderInput.parse(req.body ?? {});
    const limit = hitLimit(renderStore, `ai-render:${req.user!.id}`, RENDER_LIMIT);
    if (!limit.allowed) throw new ApiError(429, `Limite de renders por hora atingido. Tente de novo em ${Math.ceil(limit.retryAfterSec / 60)} minutos.`, undefined, "RATE_LIMITED");
    const adjust = input.adjust === "true";
    const started = Date.now();
    try {
      const out = await imageProvider().render({
        bytes: req.file.buffer,
        mime: req.file.mimetype,
        prompt: renderPrompt({ room: "ambiente", finishes: adjust ? "" : input.message, lighting: input.lighting, adjustment: adjust ? input.message : null }),
      });
      console.info("[mobieer-ai] render generated", JSON.stringify({ ms: Date.now() - started, adjust }));
      const conversationId = await recordRender(toolUser(req.user), { conversationId: input.conversationId, message: input.message, adjust });
      return ok(res, { image: `data:${out.mime};base64,${out.bytes.toString("base64")}`, mime: out.mime, conversationId });
    } catch (e) {
      if (e instanceof AiProviderError) {
        console.warn("[mobieer-ai] render error", JSON.stringify({ status: e.status ?? null, detail: e.detail ?? e.message }));
        throw new ApiError(e.status === 429 ? 429 : 502, e.status === 429 ? "A IA está com muitas solicitações agora. Tente de novo em instantes." : "Não consegui gerar o render agora. Tente de novo em instantes.", undefined, e.status === 429 ? "RATE_LIMITED" : "EXTERNAL_SERVICE_ERROR");
      }
      throw e;
    }
  })
);

router.get(
  "/conversations/:id",
  asyncHandler(async (req, res) => ok(res, await conversationMessages(toolUser(req.user), req.params.id)))
);

export default router;
