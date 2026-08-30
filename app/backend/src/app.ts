import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import { env } from "./config/env";
import authRoutes from "./modules/auth/auth.routes";
import usersRoutes from "./modules/users/users.routes";
import productsRoutes from "./modules/products/products.routes";
import categoriesRoutes from "./modules/categories/categories.routes";
import suppliersRoutes from "./modules/suppliers/suppliers.routes";
import warehousesRoutes from "./modules/warehouses/warehouses.routes";
import stockRoutes from "./modules/stock/stock.routes";
import inventoryRoutes from "./modules/inventory/inventory.routes";
import requisitionsRoutes from "./modules/requisitions/requisitions.routes";
import reportsRoutes from "./modules/reports/reports.routes";
import dashboardRoutes from "./modules/dashboard/dashboard.routes";
import notificationsRoutes from "./modules/notifications/notifications.routes";
import auditRoutes from "./modules/audit/audit.routes";
import searchRoutes from "./modules/search/search.routes";
import settingsRoutes from "./modules/settings/settings.routes";
import stockOperationsRoutes from "./modules/stock-operations/stock-operations.routes";
import activitiesRoutes from "./modules/activities/activities.routes";
import agendaRoutes from "./modules/agenda/agenda.routes";
import organizationRoutes from "./modules/organization/organization.routes";
import businessRoutes from "./modules/business/business.routes";
import documentsRoutes from "./modules/documents/documents.routes";
import portalRoutes from "./modules/portal/portal.routes";
import hrRoutes from "./modules/hr/hr.routes";
import financeRoutes from "./modules/finance/finance.routes";
import templatesRoutes from "./modules/templates/templates.routes";
import { errorHandler, notFound } from "./middlewares/errorHandler";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: [...env.frontendUrls, "https://mobieer.vercel.app", /^http:\/\/localhost:\d+$/],
      credentials: true,
    })
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => res.json({ success: true, message: "MOBIEER API OK" }));

  const uploadsDir = process.env.VERCEL ? path.join("/tmp", "uploads") : path.resolve(process.cwd(), "uploads");
  app.use("/uploads", express.static(uploadsDir));

  app.use("/api/auth", authRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/products", productsRoutes);
  app.use("/api/categories", categoriesRoutes);
  app.use("/api/suppliers", suppliersRoutes);
  app.use("/api/warehouses", warehousesRoutes);
  app.use("/api/stock", stockRoutes);
  app.use("/api/stock-operations", stockOperationsRoutes);
  app.use("/api/inventory", inventoryRoutes);
  app.use("/api/requisitions", requisitionsRoutes);
  app.use("/api/activities", activitiesRoutes);
  app.use("/api/agenda", agendaRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/search", searchRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/organization", organizationRoutes);
  app.use("/api/business", businessRoutes);
  app.use("/api/documents", documentsRoutes);
  app.use("/api/portal", portalRoutes);
  app.use("/api/hr", hrRoutes);
  app.use("/api/finance", financeRoutes);
  app.use("/api/templates", templatesRoutes);

  const frontendDist = path.resolve(__dirname, "../../frontend/dist");
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
