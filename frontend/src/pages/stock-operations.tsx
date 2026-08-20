import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost } from "@/services/api";
import type { Product, Warehouse } from "@/types";
import { PageHeader } from "@/components/page-header";
import { ProductPicker } from "@/features/stock/product-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function StockOperationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Operações de estoque" description="Transferências, reservas, devoluções, perdas e avarias." />
      <OperationsPanel />
    </div>
  );
}

function OperationsPanel() {
  const [product, setProduct] = useState<Product | null>(null);
  const [picker, setPicker] = useState(false);
  const [kind, setKind] = useState("TRANSFER");
  const [quantity, setQuantity] = useState("1");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const { data: warehouses } = useQuery({ queryKey: ["warehouses", "operations"], queryFn: () => apiGet<{ data: Warehouse[] }>("/warehouses") });
  const mutation = useMutation({
    mutationFn: () => {
      if (!product) throw new Error("Selecione um produto");
      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1) throw new Error("Quantidade inválida");
      if (kind === "TRANSFER") return apiPost("/stock-operations/transfers", { productId: product.id, quantity: qty, originWarehouseId: origin, destinationWarehouseId: destination, reason });
      if (kind === "RESERVE") return apiPost("/stock-operations/reservations", { productId: product.id, quantity: qty, warehouseId: origin || null, note: reason || null });
      return apiPost("/stock-operations/occurrences", { type: kind, productId: product.id, quantity: qty, warehouseId: origin || null, reason });
    },
    onSuccess: () => { toast.success("Operação registrada"); setProduct(null); setReason(""); queryClient.invalidateQueries(); },
    onError: (error) => toast.error((error as Error).message),
  });
  return <div className="space-y-4"><Card><CardHeader><CardTitle>Nova operação</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
    <div className="space-y-2"><Label>Tipo</Label><Select value={kind} onValueChange={setKind}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TRANSFER">Transferência</SelectItem><SelectItem value="RESERVE">Reserva</SelectItem><SelectItem value="RETURN">Devolução</SelectItem><SelectItem value="LOSS">Perda</SelectItem><SelectItem value="DAMAGE">Avaria</SelectItem></SelectContent></Select></div>
    <div className="space-y-2"><Label>Produto</Label><Button variant="outline" className="w-full justify-start" onClick={() => setPicker(true)}>{product ? product.name : <><Plus className="h-4 w-4" />Selecionar produto</>}</Button></div>
    <div className="space-y-2"><Label>Quantidade</Label><Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
    <div className="space-y-2"><Label>{kind === "TRANSFER" ? "Almoxarifado de origem" : "Almoxarifado"}</Label><WarehouseSelect value={origin} onChange={setOrigin} items={warehouses?.data ?? []} /></div>
    {kind === "TRANSFER" && <div className="space-y-2"><Label>Almoxarifado de destino</Label><WarehouseSelect value={destination} onChange={setDestination} items={warehouses?.data ?? []} /></div>}
    <div className="space-y-2 sm:col-span-2"><Label>Motivo / observação</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    <Button className="sm:col-span-2" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Registrar operação</Button>
    <ProductPicker open={picker} onOpenChange={setPicker} onSelect={setProduct} />
  </CardContent></Card><ReservationsList /></div>;
}

function WarehouseSelect({ value, onChange, items }: { value: string; onChange: (value: string) => void; items: Warehouse[] }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{items.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent></Select>;
}

type Reservation = { id: string; quantity: number; status: string; note: string | null; createdAt: string; product: { name: string; code: string }; requester: { name: string }; warehouse: { name: string } | null };

function ReservationsList() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["stock-reservations"], queryFn: () => apiGet<{ data: Reservation[] }>("/stock-operations/reservations") });
  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "FULFILL" | "CANCEL" }) => apiPatch(`/stock-operations/reservations/${id}`, { action }),
    onSuccess: () => { toast.success("Reserva atualizada"); queryClient.invalidateQueries({ queryKey: ["stock-reservations"] }); queryClient.invalidateQueries({ queryKey: ["products"] }); },
    onError: (error) => toast.error((error as Error).message),
  });
  const active = data?.data.filter((item) => item.status === "ACTIVE") ?? [];
  return <Card><CardHeader><CardTitle>Reservas ativas</CardTitle></CardHeader><CardContent>{active.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma reserva ativa.</p> : <Table><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Quantidade</TableHead><TableHead>Solicitante</TableHead><TableHead>Almoxarifado</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>{active.map((item) => <TableRow key={item.id}><TableCell>{item.product.name}<p className="text-xs text-muted-foreground">{item.product.code}</p></TableCell><TableCell>{item.quantity}</TableCell><TableCell>{item.requester.name}</TableCell><TableCell>{item.warehouse?.name ?? "—"}</TableCell><TableCell className="space-x-2 text-right"><Button size="sm" onClick={() => resolve.mutate({ id: item.id, action: "FULFILL" })}>Atender</Button><Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: item.id, action: "CANCEL" })}>Cancelar</Button></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>;
}
