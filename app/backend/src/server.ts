import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./prisma";
import { inventoryService } from "./modules/notifications/notifications.service";
import { runVacationAlerts } from "./modules/hr/hr.service";

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const app = createApp();

  await prisma.$connect();
  await inventoryService.refreshPendingInventory();

  // Alertas de férias: uma vez ao subir e depois diariamente.
  runVacationAlerts().catch((e) => console.error("[hr] runVacationAlerts falhou:", e));
  setInterval(() => {
    runVacationAlerts().catch((e) => console.error("[hr] runVacationAlerts falhou:", e));
  }, DAY_MS).unref();

  app.listen(env.port, () => {
    console.log(`\n  MOBIEER API rodando em http://localhost:${env.port}\n`);
  });
}

main().catch((err) => {
  console.error("Falha ao iniciar o servidor:", err);
  process.exit(1);
});
