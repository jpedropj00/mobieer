import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/services/api";

/** Mensagens não lidas no chat (contador do menu). Atualiza a cada 20s. */
export function useChatUnread(enabled: boolean) {
  const q = useQuery({
    queryKey: ["chat", "unread"],
    queryFn: () => apiGet<{ data: { total: number } }>("/chat/unread"),
    enabled,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
  return q.data?.data.total ?? 0;
}
