import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function KpiCard({
  title,
  value,
  unit,
  icon: Icon,
  iconBg,
  change,
  changeLabel,
}: {
  title: string;
  value: string | number;
  unit?: string;
  icon: LucideIcon;
  iconBg?: string;
  change?: number | null;
  changeLabel?: string;
}) {
  const trend = change === null || change === undefined ? null : change > 0 ? "up" : change < 0 ? "down" : "flat";
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-muted-foreground">{title}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {value}
              {unit && <span className="ml-1 text-sm font-medium text-muted-foreground">{unit}</span>}
            </p>
            {change !== undefined && (
              <div className="mt-2 flex items-center gap-1.5">
                {trend === "up" && <ArrowUpRight className="h-3.5 w-3.5 text-success" />}
                {trend === "down" && <ArrowDownRight className="h-3.5 w-3.5 text-destructive" />}
                {trend === "flat" && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
                {change !== null && trend !== "flat" ? (
                  <span className={cn("text-xs font-semibold", trend === "up" ? "text-success" : "text-destructive")}>
                    {Math.abs(change)}%
                  </span>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">—</span>
                )}
                {changeLabel && <span className="text-xs text-muted-foreground">{changeLabel}</span>}
              </div>
            )}
          </div>
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", iconBg ?? "bg-primary/10")}>
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-xl" />
      ))}
    </div>
  );
}
