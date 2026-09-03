import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, History, Search } from "lucide-react";
import { apiGet } from "@/services/api";
import type { Paginated } from "@/types";
import { formatDate, initials } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/hooks/use-auth";

type AuditLog = {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

const ACTION_LABELS: Record<string, string> = {
  STOCK_ENTRY: "Entrada de estoque",
  STOCK_EXIT: "Saída de estoque",
  STOCK_ADJUST: "Ajuste de estoque",
  REQUISITION_CREATED: "Requisição criada",
  REQUISITION_STATUS_CHANGED: "Status de requisição",
  INVENTORY_CREATED: "Inventário criado",
  INVENTORY_COUNT: "Contagem de inventário",
  INVENTORY_STATUS_CHANGED: "Status de inventário",
  PRODUCT_CREATED: "Produto criado",
  PRODUCT_UPDATED: "Produto atualizado",
  PRODUCT_DELETED: "Produto removido",
  USER_CREATED: "Usuário criado",
  USER_UPDATED: "Usuário atualizado",
  USER_DEACTIVATED: "Usuário inativado",
  ROLE_PERMISSIONS_UPDATED: "Permissões de perfil",
  LOGIN: "Login",
  LOGOUT: "Logout",
};

function actionVariant(action: string): "default" | "secondary" | "success" | "danger" | "warning" {
  if (action.includes("DELETE") || action.includes("REFUSED") || action.includes("CANCELLED")) return "danger";
  if (action.includes("CREATE") || action.includes("APPROVED") || action.includes("CONCLUDED")) return "success";
  if (action.includes("UPDATE") || action.includes("ADJUST") || action.includes("CHANGED")) return "warning";
  return "secondary";
}

export function AuditPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("ALL");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["audit", page, search, action],
    queryFn: () =>
      apiGet<{ data: AuditLog[]; meta: Paginated<AuditLog[]>["meta"]; actions: { action: string; count: number }[] }>("/audit", {
        page,
        perPage: 20,
        search,
        action: action === "ALL" ? undefined : action,
      }),
  });

  if (!can("audit.read")) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-medium">Sem permissão</p>
        <p className="text-sm text-muted-foreground">Você não tem permissão para acessar a auditoria.</p>
      </div>
    );
  }

  const logs = data?.data ?? [];
  const actions = data?.actions ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Auditoria" description="Registro de todas as ações realizadas no sistema." />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por usuário..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder="Ação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas as ações</SelectItem>
                {actions.map((a) => (
                  <SelectItem key={a.action} value={a.action}>
                    {ACTION_LABELS[a.action] ?? a.action} ({a.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={12} cols={5} />
        ) : isError ? (
          <EmptyState title="Erro ao carregar auditoria" />
        ) : logs.length === 0 ? (
          <EmptyState icon={History} title="Nenhum registro encontrado" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Entidade</TableHead>
                    <TableHead className="hidden lg:table-cell">Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(l.createdAt, true)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-[10px]">{l.user ? initials(l.user.name) : "—"}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{l.user?.name ?? "Sistema"}</p>
                            <p className="truncate text-xs text-muted-foreground">{l.user?.email ?? ""}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={actionVariant(l.action)}>{ACTION_LABELS[l.action] ?? l.action}</Badge>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{l.entity}</p>
                        <p className="truncate text-xs text-muted-foreground">{l.entityId}</p>
                      </TableCell>
                      <TableCell className="hidden max-w-[280px] lg:table-cell">
                        <code className="text-xs text-muted-foreground">{JSON.stringify(l.details ?? {})}</code>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data?.meta && <Pagination page={data.meta.page} pages={data.meta.pages} total={data.meta.total} perPage={data.meta.perPage} onChange={setPage} />}
          </>
        )}
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="h-4 w-4" />
        Os registros de auditoria são imutáveis e não podem ser editados ou removidos.
      </div>
    </div>
  );
}
