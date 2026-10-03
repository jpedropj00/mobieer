import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, Loader2, Plus, SendHorizontal, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPost } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Source = { title: string; document: string };
type Message = { id: string; role: "user" | "assistant"; content: string; sources?: Source[]; error?: boolean };
type ChatResponse = { data: { answer: string; sources: Source[]; tools_used: string[]; conversationId: string } };

const MAX_CHARS = 2000;
const SUGGESTIONS = ["O que é o Mobieer?", "Como crio um orçamento?", "Quantos projetos eu tenho?", "Quais são as minhas tarefas em aberto?"];

/** Negrito com **texto**; o resto vai como texto puro (nada de HTML vindo da IA). */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>
      )}
    </>
  );
}

/** Mobieer AI: botão flutuante e painel de conversa do assistente da equipe. */
export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => apiGet<{ data: { enabled: boolean } }>("/ai/status"), enabled: open, staleTime: 5 * 60_000 });
  const enabled = status.data?.data.enabled;

  const send = useMutation({
    mutationFn: (message: string) => apiPost<ChatResponse>("/ai/chat", { message, conversationId }),
    onSuccess: (r) => {
      setConversationId(r.data.conversationId);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: r.data.answer, sources: r.data.sources }]);
    },
    onError: (e) => setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: errorMessage(e, "Não consegui responder agora. Tente de novo."), error: true }]),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, send.isPending, open]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const ask = (raw: string) => {
    const message = raw.trim();
    if (!message || send.isPending) return;
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content: message }]);
    setText("");
    send.mutate(message);
  };
  const reset = () => {
    setMessages([]);
    setConversationId(undefined);
    setText("");
    inputRef.current?.focus();
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 h-12 gap-2 rounded-full px-4 shadow-lg" title="Abrir o Mobieer AI">
        <Sparkles className="h-5 w-5" />
        <span className="hidden sm:inline">Mobieer AI</span>
      </Button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-[85vh] flex-col border bg-card shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[600px] sm:max-h-[calc(100vh-2.5rem)] sm:w-[400px] sm:rounded-2xl" role="dialog" aria-label="Mobieer AI">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Mobieer AI</p>
            <p className="text-xs text-muted-foreground">Dúvidas sobre o sistema e os seus dados</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reset} disabled={!messages.length || send.isPending} title="Nova conversa"><Plus className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)} title="Fechar"><X className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {enabled === false && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">O Mobieer AI ainda não está configurado neste ambiente. Peça ao administrador para definir a chave do assistente no servidor.</p>
        )}
        {enabled !== false && !messages.length && (
          <div className="pt-6 text-center">
            <p className="text-sm font-medium">Como posso ajudar?</p>
            <p className="mt-1 text-xs text-muted-foreground">Respondo sobre o uso do Mobieer e consulto os seus projetos e tarefas.</p>
            <div className="mt-4 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/60">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm", m.role === "user" ? "bg-primary text-primary-foreground" : m.error ? "border border-destructive/40 bg-destructive/5 text-destructive" : "bg-muted")}>
              {m.role === "assistant" && !m.error ? <Rich text={m.content} /> : m.content}
              {!!m.sources?.length && (
                <p className="mt-2 flex items-start gap-1.5 border-t border-border/60 pt-1.5 text-xs text-muted-foreground">
                  <BookOpen className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>Fonte: Documentação Mobieer — {m.sources.map((s) => s.title).join(", ")}</span>
                </p>
              )}
            </div>
          </div>
        ))}
        {send.isPending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-muted px-3.5 py-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="flex items-end gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <Textarea
          ref={inputRef}
          rows={1}
          value={text}
          maxLength={MAX_CHARS}
          disabled={enabled === false}
          placeholder="Pergunte sobre o Mobieer…"
          className="max-h-32 min-h-[40px] resize-none"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra a linha
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask(text);
            }
          }}
        />
        <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={!text.trim() || send.isPending || enabled === false} title="Enviar">
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
