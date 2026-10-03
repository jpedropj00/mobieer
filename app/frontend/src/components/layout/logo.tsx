import { cn } from "@/lib/utils";

/** Marca da Mobieer: o nome completo, ou só o "Ø" quando a barra lateral está recolhida. */
export function Logo({ collapsed = false }: { collapsed?: boolean; dark?: boolean }) {
  return (
    <div className={cn("flex items-center overflow-hidden", collapsed && "justify-center")}>
      {collapsed ? (
        <img src="/logo-mark.png" alt="Mobieer" className="h-8 w-8 shrink-0 object-contain" />
      ) : (
        <img src="/logo.png" alt="Mobieer Planejados — casa com a sua casa" className="h-10 w-auto shrink-0 object-contain" />
      )}
    </div>
  );
}
