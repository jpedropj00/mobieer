import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal, Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet } from "@/services/api";
import type { Category, Paginated, Product } from "@/types";
import { formatNumber, UNITS } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, TableSkeleton } from "@/components/ui/states";
import { StockStatusBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { ProductFormDialog } from "@/features/products/product-form-dialog";
import { useAuth } from "@/hooks/use-auth";

export function ProductsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["products", page, search, categoryId, status],
    queryFn: () =>
      apiGet<Paginated<Product[]>>("/products", {
        page,
        perPage: 15,
        search,
        categoryId,
        status,
      }),
  });

  const { data: cats } = useQuery({ queryKey: ["categories", "all"], queryFn: () => apiGet<{ data: Category[] }>("/categories") });

  const remove = async (product: Product) => {
    if (!confirm(`Remover "${product.name}"?`)) return;
    try {
      await apiDelete(`/products/${product.id}`);
      toast.success("Produto removido");
      refetch();
    } catch (err) {
      toast.error((err as { message?: string }).message ?? "Erro ao remover");
    }
  };

  const products = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <PageHeader title="Produtos" description="Cadastro e controle de materiais do almoxarifado.">
        {can("products.create") && (
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Novo produto
          </Button>
        )}
      </PageHeader>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, código ou SKU..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>
            <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                {cats?.data.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Ativo</SelectItem>
                <SelectItem value="INACTIVE">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? (
          <TableSkeleton rows={10} cols={6} />
        ) : isError ? (
          <EmptyState title="Erro ao carregar produtos" description="Não foi possível buscar os dados." action={<Button variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button>} />
        ) : products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Nenhum produto encontrado"
            description="Ajuste os filtros ou cadastre um novo produto."
            action={can("products.create") ? <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>Cadastrar produto</Button> : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead>Mínimo</TableHead>
                    <TableHead className="hidden md:table-cell">Localização</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/produtos/${p.id}`)}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                            <Package className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{p.code}{p.sku ? ` · ${p.sku}` : ""}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{p.category?.name ?? "—"}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatNumber(p.stock)} <span className="text-xs font-normal text-muted-foreground">{UNITS[p.unit] ?? p.unit}</span>
                      </TableCell>
                      <TableCell>{formatNumber(p.minStock)}</TableCell>
                      <TableCell className="hidden max-w-[180px] md:table-cell">
                        <p className="truncate text-xs text-muted-foreground">{p.location?.full ?? "—"}</p>
                      </TableCell>
                      <TableCell>
                        <StockStatusBadge status={p.stockStatus} />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigate(`/produtos/${p.id}`)}>
                              <Package className="h-4 w-4" /> Ver detalhes
                            </DropdownMenuItem>
                            {can("products.update") && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditing(p);
                                  setDialogOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" /> Editar
                              </DropdownMenuItem>
                            )}
                            {can("products.delete") && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => remove(p)}>
                                  <Trash2 className="h-4 w-4" /> Remover
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
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

      {dialogOpen && (
        <ProductFormDialog open={dialogOpen} onOpenChange={setDialogOpen} product={editing} />
      )}
    </div>
  );
}
