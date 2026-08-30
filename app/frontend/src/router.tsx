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
const ActivitiesPage = lazy(() => import("@/pages/activities").then((m) => ({ default: m.ActivitiesPage })));
const ActivityFormPage = lazy(() => import("@/pages/activity-form").then((m) => ({ default: m.ActivityFormPage })));
const ActivityDetailPage = lazy(() => import("@/pages/activity-detail").then((m) => ({ default: m.ActivityDetailPage })));
const AgendaPage = lazy(() => import("@/pages/agenda").then((m) => ({ default: m.AgendaPage })));
const OrganizationPage = lazy(() => import("@/pages/organization").then((m) => ({ default: m.OrganizationPage })));
const MyTasksPage = lazy(() => import("@/pages/my-tasks").then((m) => ({ default: m.MyTasksPage })));
const BusinessPage = lazy(() => import("@/pages/business").then((m) => ({ default: m.BusinessPage })));
const ProjectDetailPage = lazy(() => import("@/pages/project-detail").then((m) => ({ default: m.ProjectDetailPage })));
const HrPage = lazy(() => import("@/pages/hr").then((m) => ({ default: m.HrPage })));
const FinancePage = lazy(() => import("@/pages/finance").then((m) => ({ default: m.FinancePage })));
const TemplatesPage = lazy(() => import("@/pages/templates").then((m) => ({ default: m.TemplatesPage })));

const PortalRoot = lazy(() => import("@/pages/portal/layout").then((m) => ({ default: m.PortalRoot })));
const PortalLayout = lazy(() => import("@/pages/portal/layout").then((m) => ({ default: m.PortalLayout })));
const PortalGuestRoute = lazy(() => import("@/pages/portal/layout").then((m) => ({ default: m.PortalGuestRoute })));
const PortalProtectedRoute = lazy(() => import("@/pages/portal/layout").then((m) => ({ default: m.PortalProtectedRoute })));
const PortalLoginPage = lazy(() => import("@/pages/portal/login").then((m) => ({ default: m.PortalLoginPage })));
const PortalForgotPage = lazy(() => import("@/pages/portal/forgot").then((m) => ({ default: m.PortalForgotPage })));
const PortalSetPasswordPage = lazy(() => import("@/pages/portal/set-password").then((m) => ({ default: m.PortalSetPasswordPage })));
const PortalHomePage = lazy(() => import("@/pages/portal/home").then((m) => ({ default: m.PortalHomePage })));
const PortalProjectPage = lazy(() => import("@/pages/portal/project").then((m) => ({ default: m.PortalProjectPage })));

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
          { path: "/produtos", element: <PermissionGate permission="products.read"><ProductsPage /></PermissionGate> },
          { path: "/produtos/:id", element: <PermissionGate permission="products.read"><ProductDetailPage /></PermissionGate> },
          { path: "/categorias", element: <PermissionGate permission="categories.read"><CategoriesPage /></PermissionGate> },
          { path: "/fornecedores", element: <PermissionGate permission="suppliers.read"><SuppliersPage /></PermissionGate> },
          { path: "/inventario", element: <PermissionGate permission="inventory.read"><InventoryPage /></PermissionGate> },
          { path: "/inventario/:id", element: <PermissionGate permission="inventory.read"><InventoryDetailPage /></PermissionGate> },
          { path: "/requisicoes", element: <PermissionGate permission="requisitions.read"><RequisitionsPage /></PermissionGate> },
          { path: "/requisicoes/:id", element: <PermissionGate permission="requisitions.read"><RequisitionDetailPage /></PermissionGate> },
          { path: "/atividades", element: <PermissionGate permission="activities.read"><ActivitiesPage /></PermissionGate> },
          { path: "/atividades/nova", element: <PermissionGate permission="activities.create"><ActivityFormPage /></PermissionGate> },
          { path: "/atividades/:id", element: <PermissionGate permission="activities.read"><ActivityDetailPage /></PermissionGate> },
          { path: "/atividades/:id/editar", element: <PermissionGate permission="activities.edit"><ActivityFormPage /></PermissionGate> },
          { path: "/agenda", element: <PermissionGate permission="agenda.read"><AgendaPage /></PermissionGate> },
          { path: "/organizacao", element: <PermissionGate permission="organization.read"><OrganizationPage /></PermissionGate> },
          { path: "/organizacao/:id", element: <PermissionGate permission="organization.read"><OrganizationPage /></PermissionGate> },
          { path: "/minhas-tarefas", element: <PermissionGate permission="organization.read"><MyTasksPage /></PermissionGate> },
          { path: "/clientes-projetos", element: <PermissionGate permission="organization.read"><BusinessPage /></PermissionGate> },
          { path: "/clientes-projetos/:projectId", element: <PermissionGate permission="organization.read"><ProjectDetailPage /></PermissionGate> },
          { path: "/modelos", element: <PermissionGate permission="documents.read"><TemplatesPage /></PermissionGate> },
          { path: "/alertas", element: <PermissionGate permission="stock.read"><AlertsPage /></PermissionGate> },
          { path: "/rh", element: <PermissionGate permission="hr.read"><HrPage /></PermissionGate> },
          { path: "/financeiro", element: <PermissionGate permission="finance.read"><FinancePage /></PermissionGate> },
          { path: "/relatorios", element: <ReportsPage /> },
          { path: "/usuarios", element: <PermissionGate permission="users.read"><UsersPage /></PermissionGate> },
          { path: "/auditoria", element: <PermissionGate permission="audit.read"><AuditPage /></PermissionGate> },
          { path: "/configuracoes", element: <SettingsPage /> },
        ],
      },
    ],
  },
  {
    path: "/portal",
    element: <LazyBoundary><PortalRoot /></LazyBoundary>,
    children: [
      {
        element: <LazyBoundary><PortalGuestRoute /></LazyBoundary>,
        children: [
          { path: "login", element: <LazyBoundary><PortalLoginPage /></LazyBoundary> },
          { path: "esqueci-senha", element: <LazyBoundary><PortalForgotPage /></LazyBoundary> },
          { path: "definir-senha", element: <LazyBoundary><PortalSetPasswordPage mode="invite" /></LazyBoundary> },
          { path: "redefinir-senha", element: <LazyBoundary><PortalSetPasswordPage mode="reset" /></LazyBoundary> },
        ],
      },
      {
        element: <LazyBoundary><PortalProtectedRoute /></LazyBoundary>,
        children: [
          {
            element: <LazyBoundary><PortalLayout /></LazyBoundary>,
            children: [
              { index: true, element: <LazyBoundary><PortalHomePage /></LazyBoundary> },
              { path: "projeto/:id", element: <LazyBoundary><PortalProjectPage /></LazyBoundary> },
            ],
          },
        ],
      },
    ],
  },
  { path: "*", element: <LazyBoundary><LoginPage /></LazyBoundary> },
]);
