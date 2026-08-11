import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { GuestRoute, ProtectedRoute } from "@/router-guards";
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
          { path: "/", element: <DashboardPage /> },
          { path: "/entrada", element: <StockEntryPage /> },
          { path: "/saida", element: <StockExitPage /> },
          { path: "/movimentacoes", element: <MovementsPage /> },
          { path: "/produtos", element: <ProductsPage /> },
          { path: "/produtos/:id", element: <ProductDetailPage /> },
          { path: "/categorias", element: <CategoriesPage /> },
          { path: "/fornecedores", element: <SuppliersPage /> },
          { path: "/almoxarifados", element: <WarehousesPage /> },
          { path: "/inventario", element: <InventoryPage /> },
          { path: "/inventario/:id", element: <InventoryDetailPage /> },
          { path: "/requisicoes", element: <RequisitionsPage /> },
          { path: "/requisicoes/:id", element: <RequisitionDetailPage /> },
          { path: "/alertas", element: <AlertsPage /> },
          { path: "/relatorios", element: <ReportsPage /> },
          { path: "/usuarios", element: <UsersPage /> },
          { path: "/auditoria", element: <AuditPage /> },
          { path: "/configuracoes", element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <LoginPage /> },
]);
