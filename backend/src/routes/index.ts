import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import categoriesRoutes from "../modules/categories/categories.routes";
import inventoryRoutes from "../modules/inventory/inventory.routes";
import productsRoutes from "../modules/products/products.routes";
import requisitionsRoutes from "../modules/requisitions/requisitions.routes";
import stockRoutes from "../modules/stock/stock.routes";
import suppliersRoutes from "../modules/suppliers/suppliers.routes";
import usersRoutes from "../modules/users/users.routes";
import warehousesRoutes from "../modules/warehouses/warehouses.routes";
import dashboardRoutes from "../modules/dashboard/dashboard.routes";
import reportsRoutes from "../modules/reports/reports.routes";
import notificationsRoutes from "../modules/notifications/notifications.routes";
import auditRoutes from "../modules/audit/audit.routes";
import searchRoutes from "../modules/search/search.routes";
import settingsRoutes from "../modules/settings/settings.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/products", productsRoutes);
router.use("/categories", categoriesRoutes);
router.use("/suppliers", suppliersRoutes);
router.use("/warehouses", warehousesRoutes);
router.use("/stock", stockRoutes);
router.use("/inventory", inventoryRoutes);
router.use("/requisitions", requisitionsRoutes);
router.use("/users", usersRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/reports", reportsRoutes);
router.use("/notifications", notificationsRoutes);
router.use("/audit", auditRoutes);
router.use("/search", searchRoutes);
router.use("/settings", settingsRoutes);

export default router;
