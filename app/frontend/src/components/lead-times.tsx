import { useQuery } from "@tanstack/react-query";
import { Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet } from "@/services/api";
import { errorMessage } from "@/lib/errors";

type Stats = { count: number; median: number | null; p80: number | null; min: number | null; max: number | null };
type RoomStats = Stats & { roomType: string; label: string };
type LeadTimes = {
  windowDays: number;
  minOrdersForEstimate: number;
  estimateAvailable: boolean;
  orders: { total: Stats; factory: Stats; installation: Stats };
  factoryDaysByRoom: RoomStats[];
  installationHoursByRoom: RoomStats[];
};

const days = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("pt-BR")} dia(s)`);
const hours = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("pt-BR")}h`);

/**
 * Prazos medidos do que já foi entregue: alimenta a previsão que o cliente vê
 * no portal e mostra quanto cada tipo de cômodo leva na fábrica e na montagem.
 */
export function LeadTimesCard() {
  const q = useQuery({ queryKey: ["production", "lead-times"], queryFn: () => apiGet<{ data: LeadTimes }>("/production/lead-times") });
  if (q.isLoading) return null;
  const d = q.data?.data;
  if (!d) return <p className="text-sm text-destructive">{errorMessage(q.error, "Não foi possível carregar os prazos")}</p>;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Timer className="h-4 w-4" /> Prazos medidos
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Tempo real dos pedidos entregues nos últimos {Math.round(d.windowDays / 30)} meses.{" "}
          {d.estimateAvailable
            ? "O cliente já vê a previsão de entrega calculada por aqui."
            : `A partir de ${d.minOrdersForEstimate} pedidos entregues o portal passa a mostrar a previsão ao cliente (hoje: ${d.orders.total.count}).`}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Liberação → entrega" value={days(d.orders.total.median)} hint={`8 em cada 10 até ${days(d.orders.total.p80)} · ${d.orders.total.count} pedido(s)`} />
          <Metric label="Tempo na fábrica" value={days(d.orders.factory.median)} hint={`${d.orders.factory.count} pedido(s)`} />
          <Metric label="Entrega e montagem" value={days(d.orders.installation.median)} hint={`${d.orders.installation.count} pedido(s)`} />
        </div>

        {(d.factoryDaysByRoom.length > 0 || d.installationHoursByRoom.length > 0) && (
          <div className="grid gap-4 lg:grid-cols-2">
            <RoomTable title="Fábrica por tipo de cômodo" rows={d.factoryDaysByRoom} format={days} unit="dias" />
            <RoomTable title="Montagem por tipo de cômodo" rows={d.installationHoursByRoom} format={hours} unit="horas" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function RoomTable({ title, rows, format, unit }: { title: string; rows: RoomStats[]; format: (n: number | null) => string; unit: string }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ainda sem {unit} suficientes para medir.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cômodo</TableHead>
              <TableHead className="text-right">Qtd.</TableHead>
              <TableHead className="text-right">Típico</TableHead>
              <TableHead className="text-right">8 em 10 até</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.roomType}>
                <TableCell>{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                <TableCell className="text-right tabular-nums">{format(r.median)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{format(r.p80)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
