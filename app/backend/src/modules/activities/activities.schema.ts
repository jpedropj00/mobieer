import { z } from "zod";
import { ActivityProblemPriority, ActivitySignatureRole, ActivityStatus, Unit } from "@prisma/client";

const optionalText = (max = 500) => z.string().trim().max(max).optional().nullable();
const attachment = z.object({ name: z.string().trim().min(1).max(255), url: z.string().url(), mimeType: optionalText(100), size: z.number().int().nonnegative().optional().nullable(), kind: z.enum(["PHOTO", "FILE", "PROBLEM_PHOTO"]).default("FILE") });
const material = z.object({ name: z.string().trim().min(1).max(255), productId: optionalText(100), quantity: z.number().positive(), unit: z.nativeEnum(Unit), note: optionalText(500) });
const problem = z.object({ description: z.string().trim().min(2).max(500), note: optionalText(3000), priority: z.nativeEnum(ActivityProblemPriority).default(ActivityProblemPriority.NORMAL), attachments: z.array(attachment).max(10).default([]) });

export const activityInput = z.object({
  employeeId: z.string().min(1).optional(), sector: optionalText(150), date: z.coerce.date(), startTime: optionalText(5), endTime: optionalText(5),
  clientName: optionalText(255), projectReference: optionalText(255), service: z.string().trim().min(2).max(255), description: z.string().trim().min(2).max(10000),
  problemsSummary: optionalText(5000), observations: optionalText(5000), signatureRequired: z.boolean().default(false), status: z.nativeEnum(ActivityStatus).default(ActivityStatus.DRAFT),
  agendaEventId: optionalText(100), taskId: optionalText(100), assistanceId: optionalText(100), materials: z.array(material).max(100).default([]), problems: z.array(problem).max(50).default([]), attachments: z.array(attachment).max(30).default([]),
}).refine((v) => !v.startTime || !v.endTime || v.endTime >= v.startTime, { message: "Horário de término deve ser posterior ao início", path: ["endTime"] });

export const activityQuery = z.object({ page: z.coerce.number().int().positive().default(1), perPage: z.coerce.number().int().min(1).max(100).default(15), search: z.string().optional(), employeeId: z.string().optional(), sector: z.string().optional(), client: z.string().optional(), project: z.string().optional(), service: z.string().optional(), status: z.nativeEnum(ActivityStatus).optional(), dateFrom: z.coerce.date().optional(), dateTo: z.coerce.date().optional(), sort: z.enum(["newest", "oldest", "employee", "status", "duration"]).default("newest"), my: z.enum(["true", "false"]).optional() });
export const statusInput = z.object({ status: z.nativeEnum(ActivityStatus) });
export const signatureInput = z.object({ role: z.nativeEnum(ActivitySignatureRole), signerName: z.string().trim().min(2).max(255), dataUrl: z.string().startsWith("data:image/").max(1_500_000) });
export const aiInput = z.object({ text: z.string().trim().min(10).max(5000) });
export type ActivityInput = z.infer<typeof activityInput>;
