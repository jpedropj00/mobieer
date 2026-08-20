import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { GuestRoute, ProtectedRoute } from "@/router-guards";
import { PermissionGate } from "@/components/permission-gate";

const LoginPage = lazy(() => import("@/pages/login").then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import("@/pages/dashboard").then((m) => ({ default: m.DashboardPage })));
const ProductsPage = lazy(() => import("@/pages/products").then((m) => ({ default: m.ProductsPage })));
const ProductDetailPage = lazy(() => import("@/pages/product-detail").then((m) => ({ default: m.ProductDetailPage })));
const CategoriesPage = lazy(() => import("@/pages/categories").then((m) => ({ default: m.CategoriesPage })));
const SuppliersPage = lazy(() => import("@/pages/suppliers").then((m) => ({ default: m.SuppliersPage })));
const WarehousesPage = lazy(() => import("@/pages/warehouses").then((m) => ({ default: m.WarehousesPage })));
const StockEntryPage = lazy(() => import("@/pages/stock-entry").then((m) => ({ default: m.StockEntryPage })));
const StockExitPage = lazy(() => import("@/pages/stock-exit").then((m) => ({ default: m.StockExitPage })));
const MovementsPage = lazy(() => import("@/pages/movements").then((m) => ({ default: m.MovementsPage })));
const AlertsPage = lazy(() => import("@/pages/alerts").then((m) => ({ default: m.AlertsPage })));
const InventoryPage = lazy(() => import("@/pages/inventory").then((m) => ({ default: m.InventoryPage })));
const InventoryDetailPage = lazy(() => import("@/pages/inventory-detail").then((m) => ({ default: m.InventoryDetailPage })));
const RequisitionsPage = lazy(() => import("@/pages/requisitions").then((m) => ({ default: m.RequisitionsPage })));
const RequisitionDetailPage = lazy(() => import("@/pages/requisition-detail").then((m) => ({ default: m.RequisitionDetailPage })));
const ReportsPage = lazy(() => import("@/pages/reports").then((m) => ({ default: m.ReportsPage })));
const UsersPage = lazy(() => import("@/pages/users").then((m) => ({ default: m.UsersPage })));
const AuditPage = lazy(() => import("@/pages/audit").then((m) => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import("@/pages/settings").then((m) => ({ default: m.SettingsPage })));
const StockOperationsPage = lazy(() => import("@/pages/stock-operations").then((m) => ({ default: m.StockOperationsPage })));

function LazyBoundary({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Carregando...</div>}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: <GuestRoute />,
    children: [{ path: "/login", element: <LazyBoundary><LoginPage /></LazyBoundary> }],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <LazyBoundary><AppShell /></LazyBoundary>,
        children: [
          { path: "/", element: <PermissionGate permission="dashboard.read"><DashboardPage /></PermissionGate> },
          { path: "/entrada", element: <PermissionGate permission="stock.entry"><StockEntryPage /></PermissionGate> },
          { path: "/saida", element: <PermissionGate permission="stock.exit"><StockExitPage /></PermissionGate> },
          { path: "/movimentacoes", element: <PermissionGate permission="stock.movements"><MovementsPage /></PermissionGate> },
          { path: "/operacoes-estoque", element: <PermissionGate permission="stock.scanner"><StockOperationsPage /></PermissionGate> },
          { path: "/produtos", element: <PermissionGate permission="products.read"><ProductsPage /></PermissionGate> },
          { path: "/produtos/:id", element: <PermissionGate permission="products.read"><ProductDetailPage /></PermissionGate> },
          { path: "/categorias", element: <PermissionGate permission="categories.read"><CategoriesPage /></PermissionGate> },
          { path: "/fornecedores", element: <PermissionGate permission="suppliers.read"><SuppliersPage /></PermissionGate> },
          { path: "/almoxarifados", element: <PermissionGate permission="warehouses.read"><WarehousesPage /></PermissionGate> },
          { path: "/inventario", element: <PermissionGate permission="inventory.read"><InventoryPage /></PermissionGate> },
          { path: "/inventario/:id", element: <PermissionGate permission="inventory.read"><InventoryDetailPage /></PermissionGate> },
          { path: "/requisicoes", element: <PermissionGate permission="requisitions.read"><RequisitionsPage /></PermissionGate> },
          { path: "/requisicoes/:id", element: <PermissionGate permission="requisitions.read"><RequisitionDetailPage /></PermissionGate> },
          { path: "/alertas", element: <PermissionGate permission="stock.read"><AlertsPage /></PermissionGate> },
          { path: "/relatorios", element: <ReportsPage /> },
          { path: "/usuarios", element: <PermissionGate permission="users.read"><UsersPage /></PermissionGate> },
          { path: "/auditoria", element: <PermissionGate permission="audit.read"><AuditPage /></PermissionGate> },
          { path: "/configuracoes", element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <LazyBoundary><LoginPage /></LazyBoundary> },
]);
