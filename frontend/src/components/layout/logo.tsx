import { cn } from "@/lib/utils";

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={cn("flex items-center overflow-hidden", collapsed ? "justify-center" : "gap-2.5")} aria-label="Gestium">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-lg font-black text-primary-foreground">G</span>
      {!collapsed && <div className="leading-none"><p className="text-lg font-bold tracking-tight text-white">Gestium</p><p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-sidebar-foreground/55">Gestão inteligente</p></div>}
    </div>
  );
}
