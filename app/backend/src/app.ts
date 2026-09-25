import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
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
import contractorsRoutes from "./modules/contractors/contractors.routes";
import hrRoutes from "./modules/hr/hr.routes";
import financeRoutes from "./modules/finance/finance.routes";
import templatesRoutes from "./modules/templates/templates.routes";
import commercialRoutes from "./modules/commercial/commercial.routes";
import briefingRoutes from "./modules/briefing/briefing.routes";
import appliancesRoutes from "./modules/appliances/appliances.routes";
import measurementsRoutes from "./modules/measurements/measurements.routes";
import techProjectRoutes from "./modules/techproject/techproject.routes";
import productionRoutes from "./modules/production/production.routes";
import shopFloorRoutes from "./modules/production/shopfloor.routes";
import fiscalRoutes from "./modules/fiscal/fiscal.routes";
import promobRoutes from "./modules/promob/promob.routes";
import workspaceRoutes from "./modules/workspace/workspace.routes";
import purchasesRoutes from "./modules/purchases/purchases.routes";
import productionStepsRoutes from "./modules/production/steps.routes";
import filesRoutes from "./modules/files/files.routes";
import assistanceRoutes from "./modules/assistance/assistance.routes";
import publicConfirmRoutes from "./modules/assistance/public-confirm.routes";
import cronRoutes from "./modules/cron/cron.routes";
import storeRoutes from "./modules/store/store.routes";
import partsRoutes from "./modules/parts/parts.routes";
import timelineRoutes from "./modules/timeline/timeline.routes";
import goalsRoutes from "./modules/commercial/goals.routes";
import portalFinanceRoutes from "./modules/portal/portal-finance.routes";
import agendaResponseRoutes from "./modules/agenda/response.routes";
import fieldworkRoutes from "./modules/fieldwork/fieldwork.routes";
import chatRoutes from "./modules/chat/chat.routes";
import installationRoutes from "./modules/contractors/installation.routes";
import meContractorRoutes from "./modules/contractors/me-contractor.routes";
import automationsRoutes from "./modules/automations/automations.routes";
import whatsappWebhookRoutes from "./modules/integrations/whatsapp-webhook.routes";
import integrationsRoutes from "./modules/integrations/integrations.routes";
import { errorHandler, notFound } from "./middlewares/errorHandler";

export function createApp() {
  const app = express();

  // Atrás da Vercel o IP real vem no X-Forwarded-For. Sem isto, `req.ip` é o do
  // proxy e o limite de tentativas contaria o mundo inteiro na mesma chave.
  // Um salto só: confiar em toda a cadeia deixaria o cliente forjar o próprio IP.
  app.set("trust proxy", 1);

  // Cabeçalhos de segurança. A CSP fica de fora: a API serve JSON e os uploads,
  // e o frontend é outro deploy — ligá-la aqui daria falsa sensação sem proteger
  // a página que realmente executa script.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));

  app.use(
    cors({
      origin: [...env.frontendUrls, "https://mobieer.vercel.app", /^http:\/\/localhost:\d+$/],
      credentials: true,
    })
  );
  app.use(
    express.json({
      limit: "5mb",
      // corpo cru guardado para validar a assinatura do webhook do WhatsApp
      verify: (req, _res, buf) => {
        if (req.url?.startsWith("/api/integrations/")) (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    })
  );
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
  app.use("/api/agenda", agendaResponseRoutes);
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
  app.use("/api/portal/finance", portalFinanceRoutes);
  app.use("/api/portal", portalRoutes);
  app.use("/api/hr", hrRoutes);
  app.use("/api/contractors", contractorsRoutes);
  app.use("/api/assistance", assistanceRoutes);
  app.use("/api/public", publicConfirmRoutes);
  app.use("/api/cron", cronRoutes);
  app.use("/api/automations", automationsRoutes);
  app.use("/api/store", storeRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/parts", partsRoutes);
  app.use("/api/fieldwork", fieldworkRoutes);
  app.use("/api/projects/:projectId", timelineRoutes);
  app.use("/api/installations", installationRoutes);
  app.use("/api/me/contractor", meContractorRoutes);
  app.use("/api/integrations", whatsappWebhookRoutes);
  app.use("/api/integrations", integrationsRoutes);
  app.use("/api/finance", financeRoutes);
  app.use("/api/templates", templatesRoutes);
  app.use("/api/commercial/goals", goalsRoutes);
  app.use("/api/commercial", commercialRoutes);
  app.use("/api/briefing", briefingRoutes);
  app.use("/api/appliances", appliancesRoutes);
  app.use("/api/measurements", measurementsRoutes);
  app.use("/api/tech-approval", techProjectRoutes);
  app.use("/api/production", productionRoutes);
  app.use("/api/production", shopFloorRoutes);
  app.use("/api/production", productionStepsRoutes);
  app.use("/api/fiscal", fiscalRoutes);
  app.use("/api/promob", promobRoutes);
  app.use("/api/workspace", workspaceRoutes);
  app.use("/api/purchases", purchasesRoutes);
  app.use("/api/files", filesRoutes);

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
