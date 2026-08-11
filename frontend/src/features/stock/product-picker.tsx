import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Package, Plus, Search } from "lucide-react";
import { apiGet } from "@/services/api";
import type { Paginated, Product } from "@/types";
import { formatNumber, UNITS } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyState, TableSkeleton } from "@/components/ui/states";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (product: Product) => void;
  excludeIds?: string[];
};

export function ProductPicker({ open, onOpenChange, onSelect, excludeIds = [] }: Props) {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["products", "picker", search],
    queryFn: () => apiGet<Paginated<Product[]>>("/products", { perPage: 50, search }),
    enabled: open,
  });

  const products = (data?.data ?? []).filter((p) => p.status === "ACTIVE" && !excludeIds.includes(p.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Selecionar produto</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus placeholder="Buscar por nome, código ou SKU..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {isLoading ? (
            <TableSkeleton rows={6} cols={2} />
          ) : products.length === 0 ? (
            <EmptyState icon={Package} title="Nenhum produto" description="Nenhum produto ativo encontrado." />
          ) : (
            <ul className="divide-y">
              {products.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(p);
                      onOpenChange(false);
                    }}
                    className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-accent rounded-md"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Package className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.code} · Estoque: {formatNumber(p.stock)} {UNITS[p.unit] ?? p.unit}
                      </p>
                    </div>
                    <Plus className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
