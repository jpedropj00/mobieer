import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/services/api";
import type { Product } from "@/types";
import { formatNumber, UNITS } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProductPicker } from "@/features/stock/product-picker";
import { useAuth } from "@/hooks/use-auth";

type Item = {
  product: Product;
  quantity: string;
};

export function StockExitPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [requesterName, setRequesterName] = useState("");
  const [sector, setSector] = useState("");
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!can("stock.exit")) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-medium">Sem permissão</p>
        <p className="text-sm text-muted-foreground">Você não tem permissão para registrar saídas.</p>
      </div>
    );
  }

  const updateItem = (index: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const addItem = (product: Product) => {
    if (items.some((it) => it.product.id === product.id)) {
      toast.error("Produto já adicionado");
      return;
    }
    setItems((prev) => [...prev, { product, quantity: "1" }]);
  };

  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

  const submit = async () => {
    const parsedItems = items.map((it) => ({
      productId: it.product.id,
      quantity: Number.parseInt(it.quantity, 10),
    }));
    const invalid = parsedItems.find((i) => !Number.isInteger(i.quantity) || i.quantity <= 0);
    if (invalid) return toast.error("Informe quantidades válidas e maiores que zero");
    if (parsedItems.length === 0) return toast.error("Adicione ao menos um produto");

    const lowStock = items.find((it) => Number.parseInt(it.quantity, 10) > it.product.stock);
    if (lowStock) {
      toast.error(`Estoque insuficiente de "${lowStock.product.name}" (disponível: ${formatNumber(lowStock.product.stock)})`);
      return;
    }

    setSaving(true);
    try {
      await apiPost("/stock/exits", {
        requesterName: requesterName || null,
        sector: sector || null,
        destination: destination || null,
        date: date ? new Date(date).toISOString() : undefined,
        reason: reason || null,
        note: note || null,
        items: parsedItems,
      });
      toast.success("Saída registrada com sucesso");
      navigate("/movimentacoes");
    } catch (err) {
      toast.error((err as { message?: string }).message ?? "Erro ao registrar saída");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Saída de estoque</h1>
          <p className="text-sm text-muted-foreground">Registre a retirada de materiais do almoxarifado.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Itens da saída</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhum produto adicionado ainda.
            </div>
          )}
          {items.map((it, i) => (
            <div key={it.product.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Package className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{it.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {it.product.code} · Disponível: {formatNumber(it.product.stock)} {UNITS[it.product.unit] ?? it.product.unit}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={1}
                    max={it.product.stock}
                    value={it.quantity}
                    onChange={(e) => updateItem(i, { quantity: e.target.value })}
                    className="w-24"
                    aria-label="Quantidade"
                  />
                  <span className="text-xs text-muted-foreground">{UNITS[it.product.unit] ?? it.product.unit}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeItem(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" className="w-full" onClick={() => setPickerOpen(true)}>
            <Plus className="h-4 w-4" /> Adicionar produto
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dados da retirada</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Solicitante</Label>
            <Input value={requesterName} onChange={(e) => setRequesterName(e.target.value)} placeholder="Nome de quem solicita" />
          </div>
          <div className="space-y-2">
            <Label>Setor</Label>
            <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Ex.: Produção" />
          </div>
          <div className="space-y-2">
            <Label>Destino</Label>
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Onde o material será usado" />
          </div>
          <div className="space-y-2">
            <Label>Data</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Motivo</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo da retirada" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Observações</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notas adicionais" />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => navigate(-1)}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={saving || items.length === 0}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Registrar saída
        </Button>
      </div>

      <ProductPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={addItem} excludeIds={items.map((i) => i.product.id)} />
    </div>
  );
}
