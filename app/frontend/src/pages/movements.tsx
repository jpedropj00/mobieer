import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, Search, Settings2 } from "lucide-react";
import { apiGet } from "@/services/api";
import type { Movement, Paginated } from "@/types";
import { formatNumber, UNITS } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { MovementBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";

const typeOptions = [
  { value: "ALL", label: "Todos os tipos" },
  { value: "ENTRY", label: "Entrada" },
  { value: "EXIT", label: "Saída" },
  { value: "ADJUST", label: "Ajuste" },
  { value: "TRANSFER", label: "Transferência" },
  { value: "RESERVE", label: "Reserva" },
  { value: "RELEASE", label: "Liberação" },
  { value: "RETURN", label: "Devolução" },
  { value: "LOSS", label: "Perda" },
  { value: "DAMAGE", label: "Avaria" },
];

export function MovementsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("ALL");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["movements", page, search, type],
    queryFn: () =>
      apiGet<Paginated<Movement[]>>("/stock/movements", {
        page,
        perPage: 20,
        search,
        type: type === "ALL" ? undefined : type,
      }),
  });

  const movements = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <PageHeader title="Movimentações" description="Histórico de entradas, saídas e ajustes de estoque." />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por produto..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={10} cols={6} />
        ) : isError ? (
          <EmptyState title="Erro ao carregar movimentações" description="Não foi possível buscar os dados." action={<Button variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button>} />
        ) : movements.length === 0 ? (
          <EmptyState icon={Settings2} title="Nenhuma movimentação encontrada" description="Ajuste os filtros ou registre uma nova movimentação." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead className="hidden lg:table-cell">Responsável</TableHead>
                    <TableHead className="hidden xl:table-cell">Ref. / Destino</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(m.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell>
                        <MovementBadge type={m.type} />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{m.product.name}</p>
                        <p className="text-xs text-muted-foreground">{m.product.code}</p>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-semibold ${m.type === "ENTRY" || m.type === "RETURN" ? "text-green-600" : m.type === "EXIT" || m.type === "LOSS" || m.type === "DAMAGE" ? "text-red-600" : ""}`}>
                          {m.type === "ENTRY" || m.type === "RETURN" ? "+" : m.type === "EXIT" || m.type === "LOSS" || m.type === "DAMAGE" ? "−" : "±"} {formatNumber(m.quantity)} {UNITS[m.product.unit] ?? m.product.unit}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{m.responsible?.name ?? "—"}</TableCell>
                      <TableCell className="hidden max-w-[200px] truncate xl:table-cell">
                        {m.type === "ENTRY" ? (m.supplier?.name ?? m.invoiceNumber ?? "—") : m.type === "EXIT" ? (m.requesterName ?? m.destination ?? "—") : m.note ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} perPage={meta.perPage} onChange={setPage} />}
          </>
        )}
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => navigate("/entrada")}>
          <ArrowDownToLine className="h-4 w-4" /> Nova entrada
        </Button>
        <Button onClick={() => navigate("/saida")}>
          <ArrowUpFromLine className="h-4 w-4" /> Nova saída
        </Button>
      </div>
    </div>
  );
}
