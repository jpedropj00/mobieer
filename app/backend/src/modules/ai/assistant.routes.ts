/**
 * Mobieer AI — assistente da equipe da loja: /api/ai
 *
 *   GET  /status              se está configurado e se a documentação está indexada
 *   POST /chat                { message, conversationId? } → { answer, sources, tools_used, conversationId }
 *   GET  /conversations/:id   mensagens de uma conversa do próprio usuário
 *
 * A identidade vem sempre do token (authenticate). O portal do cliente usa
 * outro login e não chega aqui.
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { hitLimit, type RateStore } from "../../utils/rate-limit";
import { ok } from "../../utils/response";
import { MAX_MESSAGE_CHARS } from "./assistant.rules";
import { chat, conversationMessages } from "./assistant.service";
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
  asyncHandler(async (_req, res) => {
    const enabled = aiProvider().enabled;
    const knowledge = enabled ? await knowledgeStats().catch(() => ({ documents: 0, chunks: 0 })) : { documents: 0, chunks: 0 };
    return ok(res, { enabled, knowledge });
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
        console.warn("[mobieer-ai] provider error", JSON.stringify({ status: e.status ?? null, retryable: e.retryable }));
        throw new ApiError(e.status === 429 ? 429 : 502, e.status === 429 ? "O assistente está com muitas solicitações agora. Tente de novo em instantes." : "Não consegui falar com o assistente agora. Tente de novo em instantes.", undefined, e.status === 429 ? "RATE_LIMITED" : "EXTERNAL_SERVICE_ERROR");
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
