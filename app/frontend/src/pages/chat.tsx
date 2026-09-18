import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, HardHat, Loader2, Paperclip, Send, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageSkeleton } from "@/components/ui/states";
import { useAuth } from "@/hooks/use-auth";
import { apiDelete, apiDownload, apiGet, apiObjectUrl, apiPost, apiPostForm } from "@/services/api";
import { errorMessage } from "@/lib/errors";
import { compressImage, fmtBytes } from "@/lib/image";
import { cn } from "@/lib/utils";

type Channel = {
  id: string;
  kind: "TEAM" | "CONTRACTORS";
  name: string;
  memberCount: number;
  unread: number;
  lastMessage: { body: string; authorName: string | null; createdAt: string } | null;
};

type Message = {
  id: string;
  channelId: string;
  body: string;
  deleted: boolean;
  createdAt: string;
  author: { id: string; name: string; imageUrl: string | null; isContractor: boolean } | null;
  attachment: { fileName: string | null; mimeType: string | null; sizeBytes: number | null; url: string } | null;
};

type MessagesResponse = { data: { channel: { id: string; kind: string; name: string }; messages: Message[]; hasMore: boolean } };

/** Limite do servidor por envio (Vercel ~4,5 MB). Fotos são reduzidas antes. */
const MAX_UPLOAD = 4 * 1024 * 1024;
const DELETE_WINDOW_MS = 15 * 60 * 1000;

const time = (v: string) => new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayLabel = (v: string) => {
  const d = new Date(v);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
};

function ImageAttachment({ url, name }: { url: string; name: string }) {
  const src = url.replace(/^\/api/, "");
  const q = useQuery({ queryKey: ["chat-img", src], queryFn: () => apiObjectUrl(src), staleTime: 10 * 60_000 });
  if (!q.data) return <div className="h-40 w-56 animate-pulse rounded-md bg-muted" />;
  return (
    <a href={q.data} target="_blank" rel="noreferrer">
      <img src={q.data} alt={name} className="max-h-60 max-w-[16rem] rounded-md border border-border object-cover" />
    </a>
  );
}

export function ChatPage() {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const channels = useQuery({
    queryKey: ["chat", "channels"],
    queryFn: () => apiGet<{ data: Channel[] }>("/chat/channels"),
    refetchInterval: 15_000,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const list = channels.data?.data ?? [];
  const active = list.find((c) => c.id === activeId) ?? list[0] ?? null;

  useEffect(() => {
    if (!activeId && list[0]) setActiveId(list[0].id);
  }, [activeId, list]);

  if (channels.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chat"
        description={user?.role === "MONTADOR" ? "Conversa com a equipe da loja." : "Canal só da equipe e canal da equipe com os montadores."}
      />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="flex gap-2 lg:flex-col">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setActiveId(c.id);
                qc.invalidateQueries({ queryKey: ["chat", "unread"] });
              }}
              className={cn(
                "flex flex-1 items-start gap-3 rounded-lg border p-3 text-left transition lg:flex-none",
                active?.id === c.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"
              )}
            >
              {c.kind === "TEAM" ? <Users className="mt-0.5 h-5 w-5 text-primary" /> : <HardHat className="mt-0.5 h-5 w-5 text-primary" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  {c.unread > 0 && active?.id !== c.id && <Badge>{c.unread}</Badge>}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {c.lastMessage ? `${c.lastMessage.authorName ?? ""}: ${c.lastMessage.body}` : `${c.memberCount} participante(s)`}
                </p>
              </div>
            </button>
          ))}
        </div>

        {active ? (
          <Conversation key={active.id} channel={active} meId={user?.id ?? ""} canModerate={can("chat.manage")} />
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum canal disponível.</p>
        )}
      </div>
    </div>
  );
}

function Conversation({ channel, meId, canModerate }: { channel: Channel; meId: string; canModerate: boolean }) {
  const qc = useQueryClient();
  const key = ["chat", "messages", channel.id];
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const lastAt = messages.length ? messages[messages.length - 1].createdAt : null;

  // carga inicial
  const initial = useQuery({
    queryKey: key,
    queryFn: () => apiGet<MessagesResponse>(`/chat/channels/${channel.id}/messages`),
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!initial.data) return;
    setMessages(initial.data.data.messages);
    setHasMore(initial.data.data.hasMore);
    void apiPost(`/chat/channels/${channel.id}/read`).then(() => qc.invalidateQueries({ queryKey: ["chat", "unread"] }));
  }, [initial.data, channel.id, qc]);

  // novas mensagens a cada 4s
  useQuery({
    queryKey: ["chat", "poll", channel.id, lastAt],
    queryFn: async () => {
      const r = await apiGet<MessagesResponse>(`/chat/channels/${channel.id}/messages`, lastAt ? { after: lastAt } : undefined);
      const fresh = r.data.messages;
      if (fresh.length) {
        setMessages((cur) => {
          const ids = new Set(cur.map((m) => m.id));
          return [...cur, ...fresh.filter((m) => !ids.has(m.id))];
        });
        await apiPost(`/chat/channels/${channel.id}/read`);
        qc.invalidateQueries({ queryKey: ["chat", "unread"] });
        qc.invalidateQueries({ queryKey: ["chat", "channels"] });
      }
      return fresh.length;
    },
    enabled: Boolean(initial.data),
    refetchInterval: 4_000,
    refetchIntervalInBackground: false,
  });

  // rola para o fim quando chega mensagem (se já estava perto do fim)
  const count = messages.length;
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom || count <= 60) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const loadOlder = useMutation({
    mutationFn: () => apiGet<MessagesResponse>(`/chat/channels/${channel.id}/messages`, { before: messages[0]?.createdAt }),
    onSuccess: (r) => {
      setMessages((cur) => [...r.data.messages, ...cur]);
      setHasMore(r.data.hasMore);
    },
    onError: (e) => toast.error(errorMessage(e, "Não foi possível carregar mensagens antigas")),
  });

  const send = useMutation({
    mutationFn: async () => {
      if (file) {
        const fd = new FormData();
        fd.append("body", text);
        fd.append("file", file, file.name);
        return apiPostForm<{ data: Message }>(`/chat/channels/${channel.id}/messages`, fd);
      }
      return apiPost<{ data: Message }>(`/chat/channels/${channel.id}/messages`, { body: text });
    },
    onSuccess: (r) => {
      setMessages((cur) => (cur.some((m) => m.id === r.data.id) ? cur : [...cur, r.data]));
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
      qc.invalidateQueries({ queryKey: ["chat", "channels"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Mensagem não enviada")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/chat/messages/${id}`),
    onSuccess: (_r, id) => setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, deleted: true, body: "", attachment: null } : m))),
    onError: (e) => toast.error(errorMessage(e, "Não foi possível apagar")),
  });

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setPreparing(true);
    try {
      const ready = f.type.startsWith("image/") ? await compressImage(f) : f;
      if (ready.size > MAX_UPLOAD) {
        toast.error(`Arquivo de ${fmtBytes(ready.size)} — o limite é ${fmtBytes(MAX_UPLOAD)}. Envie um PDF menor ou divida o arquivo.`);
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
      setFile(ready);
    } finally {
      setPreparing(false);
    }
  };

  const grouped = useMemo(() => {
    const out: { day: string; items: Message[] }[] = [];
    for (const m of messages) {
      const day = dayLabel(m.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [messages]);

  const canSend = (text.trim().length > 0 || file) && !send.isPending && !preparing;

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[420px] flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="font-medium">{channel.name}</p>
          <p className="text-xs text-muted-foreground">{channel.memberCount} participante(s)</p>
        </div>
      </div>

      <div ref={scrollerRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {initial.isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />}
        {hasMore && (
          <div className="text-center">
            <Button variant="ghost" size="sm" disabled={loadOlder.isPending} onClick={() => loadOlder.mutate()}>
              {loadOlder.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Carregar anteriores
            </Button>
          </div>
        )}
        {!initial.isLoading && messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma mensagem ainda. Comece a conversa.</p>
        )}
        {grouped.map((g) => (
          <div key={g.day} className="space-y-2">
            <p className="text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.day}</p>
            {g.items.map((m) => {
              const mine = m.author?.id === meId;
              const canDelete = !m.deleted && (canModerate || (mine && Date.now() - new Date(m.createdAt).getTime() < DELETE_WINDOW_MS));
              const isImage = m.attachment?.mimeType?.startsWith("image/");
              return (
                <div key={m.id} className={cn("group flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] space-y-1 rounded-lg px-3 py-2", mine ? "bg-primary/10" : "bg-muted/60")}>
                    {!mine && (
                      <p className="flex items-center gap-1 text-xs font-medium">
                        {m.author?.name ?? "Usuário removido"}
                        {m.author?.isContractor && <HardHat className="h-3 w-3 text-muted-foreground" aria-label="Montador" />}
                      </p>
                    )}
                    {m.deleted ? (
                      <p className="text-sm italic text-muted-foreground">Mensagem apagada</p>
                    ) : (
                      <>
                        {m.attachment &&
                          (isImage ? (
                            <ImageAttachment url={m.attachment.url} name={m.attachment.fileName ?? "imagem"} />
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                apiDownload(m.attachment!.url.replace(/^\/api/, ""), m.attachment!.fileName ?? "arquivo").catch((e) =>
                                  toast.error(errorMessage(e, "Falha ao baixar"))
                                )
                              }
                              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-sm hover:bg-muted/40"
                            >
                              <FileText className="h-5 w-5 shrink-0 text-primary" />
                              <span className="min-w-0">
                                <span className="block truncate">{m.attachment.fileName}</span>
                                {m.attachment.sizeBytes != null && (
                                  <span className="text-xs text-muted-foreground">{fmtBytes(m.attachment.sizeBytes)}</span>
                                )}
                              </span>
                              <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </button>
                          ))}
                        {m.body && <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>}
                      </>
                    )}
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-[10px] text-muted-foreground">{time(m.createdAt)}</span>
                      {canDelete && (
                        <button
                          type="button"
                          className="text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                          title="Apagar"
                          onClick={() => {
                            if (confirm("Apagar esta mensagem?")) remove.mutate(m.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="space-y-2 border-t border-border p-3">
        {file && (
          <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{file.name}</span>
              <span className="text-muted-foreground">{fmtBytes(file.size)}</span>
            </span>
            <button type="button" onClick={() => setFile(null)} aria-label="Remover anexo">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Button type="button" variant="ghost" size="icon" title="Anexar documento ou foto" disabled={preparing} onClick={() => fileRef.current?.click()}>
            {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </Button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
          <Textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escreva uma mensagem"
            className="max-h-32 min-h-[40px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) send.mutate();
              }
            }}
          />
          <Button type="button" size="icon" disabled={!canSend} onClick={() => send.mutate()} title="Enviar">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Enter envia · Shift+Enter quebra linha · documentos até {fmtBytes(MAX_UPLOAD)}</p>
      </div>
    </div>
  );
}
