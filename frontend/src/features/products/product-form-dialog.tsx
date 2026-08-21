import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut } from "@/services/api";
import type { Category, Product, Supplier, Unit, Warehouse } from "@/types";
import { UNITS } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const productSchema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  sku: z.string().optional().or(z.literal("")),
  barcode: z.string().optional().or(z.literal("")),
  qrCode: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
  unit: z.string().min(1, "Unidade obrigatória"),
  minStock: z.coerce.number().int().min(0, "Mínimo não pode ser negativo"),
  maxStock: z.coerce.number().int().min(0, "Máximo não pode ser negativo").optional().or(z.literal("")),
  unitValue: z.coerce.number().min(0, "Valor não pode ser negativo").optional().or(z.literal("")),
  categoryId: z.string().optional().or(z.literal("")),
  supplierId: z.string().optional().or(z.literal("")),
  warehouseId: z.string().optional().or(z.literal("")),
  corridor: z.string().optional().or(z.literal("")),
  shelf: z.string().optional().or(z.literal("")),
  position: z.string().optional().or(z.literal("")),
});

type ProductFormValues = z.infer<typeof productSchema>;

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  initialBarcode,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
  initialBarcode?: string;
  onCreated?: (product: Product) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(product);

  const { data: cats } = useQuery({ queryKey: ["categories", "all"], queryFn: () => apiGet<{ data: Category[] }>("/categories") });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => apiGet<{ data: Supplier[] }>("/suppliers") });
  const { data: warehouses } = useQuery({ queryKey: ["warehouses", "all"], queryFn: () => apiGet<{ data: Warehouse[] }>("/warehouses") });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({ resolver: zodResolver(productSchema), defaultValues: defaultValues(product) });

  useEffect(() => {
    if (open) reset({ ...defaultValues(product ?? null), barcode: product?.barcode ?? initialBarcode ?? "" });
  }, [open, product, initialBarcode, reset]);

  const mutation = useMutation({
    mutationFn: (values: ProductFormValues) => {
      const payload = {
        name: values.name,
        sku: values.sku || null,
        barcode: values.barcode || null,
        qrCode: values.qrCode || null,
        description: values.description || null,
        unit: values.unit as Unit,
        minStock: Number(values.minStock || 0),
        maxStock: values.maxStock ? Number(values.maxStock) : null,
        unitValue: values.unitValue ? Number(values.unitValue) : null,
        categoryId: values.categoryId || null,
        supplierId: values.supplierId || null,
        warehouseId: values.warehouseId || null,
        corridor: values.corridor || null,
        shelf: values.shelf || null,
        position: values.position || null,
      };
      return isEdit
        ? apiPut<{ data: Product }>(`/products/${product!.id}`, payload)
        : apiPost<{ data: Product }>("/products", payload);
    },
    onSuccess: (result) => {
      toast.success(isEdit ? "Produto atualizado com sucesso" : "Produto cadastrado com sucesso");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (!isEdit) onCreated?.(result.data);
      onOpenChange(false);
    },
    onError: (err) => toast.error((err as { message?: string }).message ?? "Erro ao salvar produto"),
  });

  const onSubmit = (values: ProductFormValues) => mutation.mutate(values);
  const unit = watch("unit") || "UNIT";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription>
            {isEdit ? `Atualize os dados de ${product?.name} (${product?.code})` : "Preencha os dados para cadastrar um novo material."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome *</Label>
            <Input id="name" placeholder="Ex.: Parafuso sextavado M8" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" placeholder="Código interno do fornecedor" {...register("sku")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Unidade de medida *</Label>
              <Select value={unit} onValueChange={(v) => setValue("unit", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(UNITS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="barcode">Código de barras</Label>
              <Input id="barcode" placeholder="EAN, UPC ou código do leitor" {...register("barcode")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qrCode">Conteúdo do QR Code</Label>
              <Input id="qrCode" placeholder="Código ou conteúdo do QR" {...register("qrCode")} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="minStock">Estoque mínimo</Label>
              <Input id="minStock" type="number" min={0} placeholder="0" {...register("minStock")} />
              {errors.minStock && <p className="text-xs text-destructive">{errors.minStock.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxStock">Estoque máximo</Label>
              <Input id="maxStock" type="number" min={0} placeholder="—" {...register("maxStock")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unitValue">Valor unitário (R$)</Label>
              <Input id="unitValue" type="number" min={0} step="0.01" placeholder="0,00" {...register("unitValue")} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={watch("categoryId") || ""} onValueChange={(v) => setValue("categoryId", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {cats?.data.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fornecedor</Label>
              <Select value={watch("supplierId") || ""} onValueChange={(v) => setValue("supplierId", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers?.data.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Almoxarifado</Label>
              <Select value={watch("warehouseId") || ""} onValueChange={(v) => setValue("warehouseId", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses?.data.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="corridor">Corredor</Label>
              <Input id="corridor" placeholder="Ex.: B" {...register("corridor")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shelf">Prateleira</Label>
              <Input id="shelf" placeholder="Ex.: 04" {...register("shelf")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="position">Posição</Label>
              <Input id="position" placeholder="Ex.: 02" {...register("position")} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea id="description" placeholder="Informações adicionais do material" {...register("description")} />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Salvar alterações" : "Cadastrar produto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function defaultValues(product?: Product | null): ProductFormValues {
  return {
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    qrCode: product?.qrCode ?? "",
    description: product?.description ?? "",
    unit: product?.unit ?? "UNIT",
    minStock: product?.minStock ?? 0,
    maxStock: product?.maxStock ?? "",
    unitValue: product?.unitValue ?? "",
    categoryId: product?.category?.id ?? "",
    supplierId: product?.supplier?.id ?? "",
    warehouseId: product?.location?.warehouseId ?? "",
    corridor: product?.location?.corridor ?? "",
    shelf: product?.location?.shelf ?? "",
    position: product?.location?.position ?? "",
  };
}
