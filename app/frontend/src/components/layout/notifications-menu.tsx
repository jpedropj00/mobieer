import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { apiGet, apiPatch } from "@/services/api";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Notification } from "@/types";

const TYPE_STYLE: Record<string, string> = {
  LOW_STOCK: "bg-warning/15 text-warning",
  OUT_OF_STOCK: "bg-destructive/10 text-destructive",
  NEW_REQUISITION: "bg-primary/15 text-primary",
  REQUISITION_APPROVED: "bg-success/15 text-success",
  REQUISITION_REFUSED: "bg-destructive/10 text-destructive",
  INVENTORY_PENDING: "bg-secondary text-secondary-foreground",
  MOVEMENT: "bg-secondary text-secondary-foreground",
  INFO: "bg-muted text-muted-foreground",
};

const TYPE_LABEL: Record<string, string> = {
  LOW_STOCK: "Estoque baixo",
  OUT_OF_STOCK: "Sem estoque",
  NEW_REQUISITION: "Requisição",
  REQUISITION_APPROVED: "Aprovada",
  REQUISITION_REFUSED: "Recusada",
  INVENTORY_PENDING: "Inventário",
  MOVEMENT: "Movimentação",
  INFO: "Informação",
};

export function NotificationsMenu() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<{ data: { items: Notification[]; unreadCount: number } }>("/notifications", { limit: 15 }),
    refetchInterval: 60_000,
  });

  const markAll = useMutation({
    mutationFn: () => apiPatch("/notifications/read-all"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => apiPatch(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const notifications = data?.data.items ?? [];
  const unread = data?.data.unreadCount ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative rounded-lg p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-primary/40">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="px-0">Notificações</DropdownMenuLabel>
          {unread > 0 && (
            <button onClick={() => markAll.mutate()} className="text-xs text-primary hover:underline">
              Marcar todas como lidas
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhuma notificação</div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {notifications.map((n) => (
              <DropdownMenuItem key={n.id} className="flex cursor-default items-start gap-2.5 px-3 py-2.5" onClick={() => markOne.mutate(n.id)}>
                <span className={`mt-0.5 flex h-2 w-2 shrink-0 rounded-full ${TYPE_STYLE[n.type] ?? "bg-muted"} ${n.read ? "opacity-30" : ""}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{n.title}</p>
                    <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                      {TYPE_LABEL[n.type] ?? n.type}
                    </Badge>
                  </div>
                  {n.message && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>}
                  <p className="mt-1 text-[10px] text-muted-foreground/70">{formatDate(n.createdAt, true)}</p>
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
