import { Box } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ collapsed = false, dark = true }: { collapsed?: boolean; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 overflow-hidden">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/90 shadow-soft">
        <Box className="h-5 w-5 text-primary-foreground" />
      </div>
      {!collapsed && (
        <div className="flex flex-col leading-none">
          <span className={cn("text-lg font-extrabold tracking-tight", dark ? "text-white" : "text-foreground")}>
            MOBIEER
          </span>
          <span className={cn("text-[10px] font-medium uppercase tracking-[0.18em]", dark ? "text-sidebar-muted" : "text-muted-foreground")}>
            Almoxarifado
          </span>
        </div>
      )}
    </div>
  );
}
