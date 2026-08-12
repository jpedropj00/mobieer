import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { GuestRoute, ProtectedRoute } from "@/router-guards";
import { PermissionGate } from "@/components/permission-gate";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";
import { ProductsPage } from "@/pages/products";
import { ProductDetailPage } from "@/pages/product-detail";
import { CategoriesPage } from "@/pages/categories";
import { SuppliersPage } from "@/pages/suppliers";
import { WarehousesPage } from "@/pages/warehouses";
import { StockEntryPage } from "@/pages/stock-entry";
import { StockExitPage } from "@/pages/stock-exit";
import { MovementsPage } from "@/pages/movements";
import { AlertsPage } from "@/pages/alerts";
import { InventoryPage } from "@/pages/inventory";
import { InventoryDetailPage } from "@/pages/inventory-detail";
import { RequisitionsPage } from "@/pages/requisitions";
import { RequisitionDetailPage } from "@/pages/requisition-detail";
import { ReportsPage } from "@/pages/reports";
import { UsersPage } from "@/pages/users";
import { AuditPage } from "@/pages/audit";
import { SettingsPage } from "@/pages/settings";

export const router = createBrowserRouter([
  {
    element: <GuestRoute />,
    children: [{ path: "/login", element: <LoginPage /> }],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <PermissionGate permission="dashboard.read"><DashboardPage /></PermissionGate> },
          { path: "/entrada", element: <PermissionGate permission="stock.entry"><StockEntryPage /></PermissionGate> },
          { path: "/saida", element: <PermissionGate permission="stock.exit"><StockExitPage /></PermissionGate> },
          { path: "/movimentacoes", element: <PermissionGate permission="stock.movements"><MovementsPage /></PermissionGate> },
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
  { path: "*", element: <LoginPage /> },
]);
