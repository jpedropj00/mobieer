import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./prisma";
import { inventoryService } from "./modules/notifications/notifications.service";

async function main() {
  const app = createApp();

  await prisma.$connect();
  await inventoryService.refreshPendingInventory();

  app.listen(env.port, () => {
    console.log(`\n  MOBIEER Almoxarifado API rodando em http://localhost:${env.port}\n`);
  });
}

main().catch((err) => {
  console.error("Falha ao iniciar o servidor:", err);
  process.exit(1);
});
