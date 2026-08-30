import { z } from "zod";

export const chartQuery = z.object({
  period: z.enum(["7d", "30d", "3m", "6m", "1y"]).default("30d"),
});

export type ChartPeriod = z.infer<typeof chartQuery>["period"];
