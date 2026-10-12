import type { Task } from "./db";
import { addDays, nowStamp } from "./dates";

/*
 * Срок задачи: указан только конец времени, без начала. Так быстрой задаче ставят «до 18:00».
 * Подсвечивается как прежний дедлайн: красным, когда прошёл, янтарным, когда сегодня или завтра. Чистая логика под тесты.
 */

export type DueTask = Pick<Task, "due_date" | "start_time" | "end_time" | "status">;

/** Задача со сроком: есть день и конец, а начала нет */
export const hasDue = (x: DueTask) => !!x.due_date && !x.start_time && !!x.end_time;

/** overdue — срок прошёл, soon — срок сегодня или завтра. У сделанных и без срока ничего */
export function dueState(x: DueTask, now = nowStamp()): "overdue" | "soon" | null {
  if (!hasDue(x) || (x.status !== "inbox" && x.status !== "active")) return null;
  if (`${x.due_date}T${x.end_time}` < now.slice(0, 16)) return "overdue";
  return x.due_date! <= addDays(now.slice(0, 10), 1) ? "soon" : null;
}
