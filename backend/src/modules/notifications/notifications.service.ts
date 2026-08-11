import { NotificationType } from "@prisma/client";
import { prisma } from "../../prisma";

export const inventoryService = {
  async refreshPendingInventory() {
    const pending = await prisma.inventory.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } });
    const existing = await prisma.notification.findFirst({
      where: { type: NotificationType.INVENTORY_PENDING, read: false },
    });

    if (pending > 0 && !existing) {
      await prisma.notification.create({
        data: {
          type: NotificationType.INVENTORY_PENDING,
          title: "Inventário pendente",
          message: `Existem ${pending} inventário(s) em andamento`,
        },
      });
    }
    return pending;
  },
};
