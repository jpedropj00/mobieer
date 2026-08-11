import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Pagination({
  page,
  pages,
  total,
  perPage,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  const items: (number | "...")[] = [];
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) items.push(i);
  } else {
    items.push(1);
    if (page > 3) items.push("...");
    for (let i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i++) items.push(i);
    if (page < pages - 2) items.push("...");
    items.push(pages);
  }

  return (
    <div className="flex flex-col items-center justify-between gap-3 px-4 py-3 sm:flex-row">
      <p className="text-xs text-muted-foreground">
        Exibindo <span className="font-medium text-foreground">{from}–{to}</span> de{" "}
        <span className="font-medium text-foreground">{total.toLocaleString("pt-BR")}</span> registros
      </p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {items.map((item, i) =>
          item === "..." ? (
            <span key={`e-${i}`} className="px-1 text-xs text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              key={item}
              variant={item === page ? "default" : "ghost"}
              size="icon"
              className={cn("h-8 w-8 text-xs", item === page && "pointer-events-none")}
              onClick={() => onChange(item)}
            >
              {item}
            </Button>
          )
        )}
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
