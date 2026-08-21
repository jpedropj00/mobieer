import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  FileClock,
  LayoutDashboard,
  Package,
  ScrollText,
  ScanLine,
  Scissors,
  Settings,
  Tags,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Logo } from "./logo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  permission?: string;
  end?: boolean;
};

type NavGroup = {
  label?: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ label: "Dashboard", to: "/", icon: LayoutDashboard, permission: "dashboard.read", end: true }],
  },
  {
    label: "Estoque",
    items: [
      { label: "Entrada de Materiais", to: "/entrada", icon: ArrowDownToLine, permission: "stock.entry" },
      { label: "Saída de Materiais", to: "/saida", icon: ArrowUpFromLine, permission: "stock.exit" },
      { label: "Movimentações", to: "/movimentacoes", icon: ArrowLeftRight, permission: "stock.movements" },
      { label: "Operações", to: "/operacoes-estoque", icon: ScanLine, permission: "stock.scanner" },
      { label: "Produtos", to: "/produtos", icon: Package, permission: "products.read" },
      { label: "Categorias", to: "/categorias", icon: Tags, permission: "categories.read" },
      { label: "Fornecedores", to: "/fornecedores", icon: Truck, permission: "suppliers.read" },
      { label: "Almoxarifados", to: "/almoxarifados", icon: Warehouse, permission: "warehouses.read" },
    ],
  },
  {
    label: "Requisições e produção",
    items: [
      { label: "Requisições de Peças", to: "/requisicoes", icon: Scissors, permission: "requisitions.read" },
      { label: "Atividades", to: "/atividades", icon: FileClock, permission: "activities.read" },
      { label: "Agenda", to: "/agenda", icon: CalendarDays, permission: "agenda.read" },
    ],
  },
  {
    label: "Controle de estoque",
    items: [
      { label: "Inventário", to: "/inventario", icon: ClipboardCheck, permission: "inventory.read" },
      { label: "Alertas de Estoque", to: "/alertas", icon: AlertTriangle, permission: "stock.read" },
    ],
  },
  {
    label: "Administração",
    items: [
      { label: "Relatórios", to: "/relatorios", icon: BarChart3, permission: "reports.read" },
      { label: "Usuários", to: "/usuarios", icon: Users, permission: "users.read" },
      { label: "Auditoria", to: "/auditoria", icon: ScrollText, permission: "audit.read" },
      { label: "Configurações", to: "/configuracoes", icon: Settings },
    ],
  },
];

export function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { can } = useAuth();
  const location = useLocation();

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || can(i.permission)),
  })).filter((g) => g.items.length > 0);

  const link = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          collapsed && "justify-center px-0",
          isActive
            ? "bg-primary/15 text-white"
            : "text-sidebar-foreground/75 hover:bg-sidebar-muted/20 hover:text-white"
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />}
          <item.icon className={cn("h-[18px] w-[18px] shrink-0", isActive ? "text-primary" : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground")} />
          {!collapsed && <span>{item.label}</span>}
        </>
      )}
    </NavLink>
  );

  const content = (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-16 items-center border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
        <Logo collapsed={collapsed} />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4 scrollbar-thin">
        {groups.map((group, gi) => (
          <div key={gi} className="space-y-1">
            {group.label && !collapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
                {group.label}
              </p>
            )}
            <div className="space-y-1">
              {group.items.map((item) =>
                collapsed ? (
                  <TooltipProvider key={item.to} delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>{link(item)}</TooltipTrigger>
                      <TooltipContent side="right" className="bg-white text-foreground border">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  link(item)
                )
              )}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className={cn("rounded-lg bg-sidebar-muted/15 p-3", collapsed && "p-2 text-center")}>
          {!collapsed ? (
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-primary" />
              <div className="text-[11px] leading-tight text-sidebar-foreground/70">
                <p className="font-medium text-sidebar-foreground">Gestium</p>
                <p>Gestão inteligente</p>
              </div>
            </div>
          ) : (
            <AlertTriangle className="h-4 w-4 text-primary" />
          )}
        </div>
      </div>
    </div>
  );

  return <>{content}</>;
}

export { NAV_GROUPS };
