import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "./global-search";
import { NotificationsMenu } from "./notifications-menu";
import { UserMenu } from "./user-menu";
import { cn } from "@/lib/utils";

export function Navbar({
  onMenuClick,
  collapsed,
  onToggleCollapse,
}: {
  onMenuClick: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-sidebar-border bg-navbar px-3 sm:px-4">
      <Button variant="ghost" size="icon" className="text-white/70 hover:bg-white/10 hover:text-white lg:hidden" onClick={onMenuClick}>
        <Menu className="h-5 w-5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="hidden text-white/70 hover:bg-white/10 hover:text-white lg:inline-flex"
        onClick={onToggleCollapse}
      >
        {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
      </Button>

      <div className={cn("flex flex-1 justify-center")}>
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <NotificationsMenu />
        <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />
        <UserMenu />
      </div>
    </header>
  );
}
