/**
 * Orquestração do Mobieer AI: histórico → busca na documentação → Gemini com
 * as ferramentas do usuário → conferência de escopo → grava a conversa.
 */
import { prisma } from "../../prisma";
import { NotFoundError } from "../../utils/ApiError";
import { MAX_HISTORY_TURNS, contextBlock, conversationTitle, finalAnswer, sourcesOf, systemPrompt, type ChatTurn, type RetrievedChunk } from "./assistant.rules";
import { aiProvider } from "./provider";
import { searchKnowledge } from "./rag/rag.service";
import { executeTool, toolsFor, type ToolUser } from "./tools";

/** Log de desenvolvimento: só o evento e números, nunca o texto da conversa nem credenciais. */
const log = (event: string, data: Record<string, unknown> = {}) => console.info(`[mobieer-ai] ${event}`, JSON.stringify(data));

async function conversationFor(user: ToolUser, conversationId: string | undefined, message: string) {
  if (conversationId) {
    // a conversa precisa ser do próprio usuário
    const c = await prisma.aiConversation.findFirst({ where: { id: conversationId, userId: user.id }, select: { id: true } });
    if (!c) throw new NotFoundError("Conversa não encontrada");
    return c.id;
  }
  const c = await prisma.aiConversation.create({ data: { userId: user.id, organizationId: user.organizationId, title: conversationTitle(message) }, select: { id: true } });
  return c.id;
}

export async function chat(user: ToolUser, input: { message: string; conversationId?: string }) {
  const started = Date.now();
  const conversationId = await conversationFor(user, input.conversationId, input.message);
  log("AI request started", { conversationId, chars: input.message.length });

  const previous = await prisma.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: MAX_HISTORY_TURNS, select: { role: true, content: true } });
  const history: ChatTurn[] = previous.reverse().map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  // sem a base indexada (ou com a busca fora do ar) o assistente segue só com as ferramentas
  let chunks: RetrievedChunk[] = [];
  try {
    chunks = await searchKnowledge(input.message);
    log("RAG search completed", { chunks: chunks.length, top: chunks[0]?.similarity ?? null });
  } catch (e) {
    log("RAG search failed", { reason: e instanceof Error ? e.message.slice(0, 120) : "erro" });
  }

  const result = await aiProvider().run({
    system: systemPrompt(user),
    history,
    message: `${contextBlock(chunks)}\n\nPERGUNTA DO USUÁRIO\n${input.message}`,
    tools: toolsFor(user),
    executeTool: async (call) => {
      log("MCP tool called", { tool: call.name });
      return executeTool(user, call);
    },
  });

  const out = finalAnswer(result.text, sourcesOf(chunks), result.toolsUsed);
  log("Gemini response generated", { inScope: out.inScope, tools: out.toolsUsed.length, sources: out.sources.length, ms: Date.now() - started });

  await prisma.$transaction([
    prisma.aiMessage.create({ data: { conversationId, role: "user", content: input.message } }),
    prisma.aiMessage.create({ data: { conversationId, role: "assistant", content: out.answer, sources: out.sources, toolsUsed: out.toolsUsed } }),
    prisma.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);

  return { answer: out.answer, sources: out.sources, tools_used: out.toolsUsed, conversationId };
}

export async function conversationMessages(user: ToolUser, conversationId: string) {
  const c = await prisma.aiConversation.findFirst({
    where: { id: conversationId, userId: user.id },
    select: { id: true, title: true, messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true, sources: true, createdAt: true } } },
  });
  if (!c) throw new NotFoundError("Conversa não encontrada");
  return c;
}
