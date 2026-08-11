import type { Response } from "express";

export function ok<T>(res: Response, data: T, message?: string) {
  return res.json({ success: true, message, data });
}

export function paginated<T>(
  res: Response,
  items: T,
  meta: { page: number; perPage: number; total: number; pages: number }
) {
  return res.json({ success: true, data: items, meta });
}
