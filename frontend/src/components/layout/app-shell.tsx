import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";
import { cn } from "@/lib/utils";

export function AppShell() {
  const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (isTablet) setCollapsed(true);
    if (isDesktop) setCollapsed(false);
  }, [isTablet, isDesktop]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop / tablet sidebar */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
          collapsed ? "md:w-[72px]" : "md:w-64"
        )}
      >
        <Sidebar collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          className="left-0 top-0 h-full max-h-none w-72 translate-x-0 translate-y-0 rounded-none border-0 border-r border-sidebar-border bg-sidebar p-0 shadow-none data-[state=open]:slide-in-from-left"
          hideCloseButton
        >
          <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </DialogContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar
          onMenuClick={() => setMobileOpen(true)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
