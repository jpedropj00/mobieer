import { cn } from "@/lib/utils";

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center overflow-hidden">
      <img
        src="/favicon.png"
        alt="MOBIEER"
        draggable={false}
        className={cn("w-auto object-contain", collapsed ? "h-8" : "h-10")}
      />
    </div>
  );
}
