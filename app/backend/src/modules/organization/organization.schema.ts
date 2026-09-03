import { KanbanBoardStatus, KanbanBoardVisibility, KanbanTaskPriority } from "@prisma/client";
import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const boardInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: optionalText(2000),
  ownerId: z.string().min(1).optional(),
  team: optionalText(120),
  visibility: z.nativeEnum(KanbanBoardVisibility).default("TEAM"),
  status: z.nativeEnum(KanbanBoardStatus).default("ACTIVE"),
});

export const columnInput = z.object({
  name: z.string().trim().min(1).max(100),
  position: z.number().int().min(0).optional(),
  cardLimit: z.number().int().positive().optional().nullable(),
  isInitial: z.boolean().default(false),
  isCompletion: z.boolean().default(false),
});

export const taskInput = z.object({
  columnId: z.string().min(1), title: z.string().trim().min(2).max(255), description: optionalText(10000),
  assigneeId: z.string().optional().nullable(), participantIds: z.array(z.string()).max(50).default([]),
  team: optionalText(120), sector: optionalText(120), priority: z.nativeEnum(KanbanTaskPriority).default("NORMAL"),
  labelIds: z.array(z.string()).max(30).default([]), startAt: z.coerce.date().optional().nullable(), dueAt: z.coerce.date().optional().nullable(),
  clientId: z.string().optional().nullable(), projectId: z.string().optional().nullable(), assistanceId: z.string().optional().nullable(),
  requisitionId: z.string().optional().nullable(), agendaEventId: z.string().optional().nullable(), observations: optionalText(10000),
});

export const taskUpdate = taskInput.omit({ columnId: true }).partial();
export const moveInput = z.object({ columnId: z.string().min(1), position: z.number().int().min(0).default(0) });
export const labelInput = z.object({ name: z.string().trim().min(1).max(60), color: z.string().trim().min(1).max(30).default("slate") });
export const itemInput = z.object({ title: z.string().trim().min(1).max(255), position: z.number().int().min(0).optional(), assigneeId: z.string().optional().nullable(), dueAt: z.coerce.date().optional().nullable(), observation: optionalText(2000) });
export const commentInput = z.object({ body: z.string().trim().min(1).max(10000) });
export const attachmentInput = z.object({ name: z.string().trim().min(1).max(255), url: z.string().min(1).max(2000), mimeType: optionalText(150), size: z.number().int().min(0).optional().nullable() });
export const recurrenceInput = z.object({ title: z.string().trim().min(2).max(255), description: optionalText(10000), priority: z.nativeEnum(KanbanTaskPriority).default("NORMAL"), frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]), interval: z.number().int().min(1).max(24).default(1), weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]), nextRunAt: z.coerce.date(), endAt: z.coerce.date().optional().nullable(), columnId: z.string().min(1), assigneeId: z.string().optional().nullable() });
