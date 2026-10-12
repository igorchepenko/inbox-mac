import { vi } from "vitest";
import type { Task } from "../db";

/** Фиксируем «сегодня»: суббота, 10 октября 2026, полдень */
export const TODAY = "2026-10-10";
export const freezeToday = () => vi.useFakeTimers({ now: new Date(2026, 9, 10, 12, 0, 0) });

let seq = 0;
export function task(p: Partial<Task> = {}): Task {
  const id = p.id ?? ++seq;
  return {
    id, title: `Задача ${id}`, note: "", status: "active", priority: 0, project_id: null,
    due_date: null, remind_at: null, reminded: 0, created_at: "2026-10-01T10:00:00",
    triaged_at: null, done_at: null, start_time: null, end_time: null, quadrant: null,
    recurrence: null, series_id: null, next_id: null, started_at: null,
    assigned_by: null, remind_before: null, kind: "task", subtasks: [], links: [], files: [], tags: [],
    ...p,
  };
}
