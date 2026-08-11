import path from "path";
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
import { errorHandler, notFound } from "./middlewares/errorHandler";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: [...env.frontendUrls, /^http:\/\/localhost:\d+$/],
      credentials: true,
    })
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => res.json({ success: true, message: "MOBIEER API OK" }));

  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

  app.use("/api/auth", authRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/products", productsRoutes);
  app.use("/api/categories", categoriesRoutes);
  app.use("/api/suppliers", suppliersRoutes);
  app.use("/api/warehouses", warehousesRoutes);
  app.use("/api/stock", stockRoutes);
  app.use("/api/inventory", inventoryRoutes);
  app.use("/api/requisitions", requisitionsRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/search", searchRoutes);
  app.use("/api/settings", settingsRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
