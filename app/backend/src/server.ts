import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./prisma";
import { inventoryService } from "./modules/notifications/notifications.service";
import { runDailyJobs } from "./jobs/daily";

const DAY_MS = 24 * 60 * 60 * 1000;

// Rede de segurança do processo. Rotas já passam pelo errorHandler; isto pega o
// que escapa (promessa sem catch, callback de biblioteca) e deixa rastro no log.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  // Estado do processo não é mais confiável: registra e sai para o supervisor reiniciar.
  console.error("[uncaughtException]", err);
  process.exit(1);
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    prisma
      .$disconnect()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
}

async function main() {
  const app = createApp();

  await prisma.$connect();
  await inventoryService.refreshPendingInventory();

  // Rotinas diárias (alertas, lembretes, pós-venda). Em produção quem dispara é
  // o Vercel Cron (/api/cron/daily); aqui roda ao subir e a cada 24h.
  if (!process.env.DISABLE_LOCAL_JOBS) {
    runDailyJobs().catch((e) => console.error("[jobs] rotinas diárias falharam:", e));
    setInterval(() => {
      runDailyJobs().catch((e) => console.error("[jobs] rotinas diárias falharam:", e));
    }, DAY_MS).unref();
  }

  app.listen(env.port, () => {
    console.log(`\n  MOBIEER API rodando em http://localhost:${env.port}\n`);
  });
}

main().catch((err) => {
  console.error("Falha ao iniciar o servidor:", err);
  process.exit(1);
});
