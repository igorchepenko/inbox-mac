import type { Task } from "./db";
import { addDays, daysBetween, fmtDay, nowStamp, stampDay } from "./dates";
import { pref } from "./prefs";

/*
 * Дедлайн: крайний срок задачи, отдельно от даты и времени «от–до».
 * В базе день YYYY-MM-DD или момент YYYY-MM-DDTHH:MM, если указано время. Чистая логика под тесты.
 */

/** Время дедлайна «18:00» или null, если указан только день */
export const deadlineTime = (d: string): string | null => (d.length > 10 ? d.slice(11, 16) : null);

/** Собрать дедлайн из дня и необязательного времени */
export const makeDeadline = (day: string | null, time: string | null): string | null => (day ? (time ? `${day}T${time}` : day) : null);

/** Момент, когда срок истекает: время дедлайна, а без времени конец дня */
export const deadlineEnd = (d: string) => `${stampDay(d)}T${deadlineTime(d) ?? "23:59"}`;

const open = (x: Task) => x.status === "inbox" || x.status === "active";

/**
 * Как подсветить дедлайн: overdue — срок прошёл (красный), soon — срок сегодня или завтра (янтарный).
 * У сделанных и без дедлайна ничего
 */
export function deadlineState(x: Task, now = nowStamp()): "overdue" | "soon" | null {
  if (!x.deadline || !open(x)) return null;
  if (deadlineEnd(x.deadline) < now.slice(0, 16)) return "overdue";
  return stampDay(x.deadline) <= addDays(stampDay(now), 1) ? "soon" : null;
}

/** «Завтра», «Пт, 16 окт 18:00» */
export function fmtDeadline(d: string): string {
  const time = deadlineTime(d);
  return time ? `${fmtDay(stampDay(d))} ${time}` : fmtDay(stampDay(d));
}

/** Порядок по дедлайну: ближайшие сверху, без дедлайна в конце */
export function compareDeadline(a: Task, b: Task): number {
  if (a.deadline && b.deadline) return deadlineEnd(a.deadline) < deadlineEnd(b.deadline) ? -1 : deadlineEnd(a.deadline) > deadlineEnd(b.deadline) ? 1 : 0;
  return (a.deadline ? 0 : 1) - (b.deadline ? 0 : 1);
}

/** Настройки уведомления: включено, за сколько дней (0 — в тот же день) и во сколько */
export interface DeadlineAlert {
  on: boolean;
  days: number;
  time: string;
}

export const DEADLINE_DAYS = [0, 1, 2, 3, 7];

export function alertOf(settings: Record<string, string>): DeadlineAlert {
  const days = Number(pref(settings, "deadline.days"));
  return {
    on: pref(settings, "deadline.notify") === "1",
    days: Number.isInteger(days) && days >= 0 ? days : 1,
    time: pref(settings, "deadline.time"),
  };
}

/** Когда напомнить о дедлайне. Не позже самого дедлайна: дедлайн в 9:00 при уведомлении в 10:00 в тот же день придёт в 9:00 */
export function alertAt(deadline: string, a: DeadlineAlert): string {
  const at = `${addDays(stampDay(deadline), -a.days)}T${a.time}`;
  const end = deadlineEnd(deadline);
  return at < end ? at : end;
}

/**
 * Какие задачи пора предупредить о дедлайне сейчас. Если дедлайн уже прошёл (Мак был выключен),
 * уведомлять поздно: такие задачи отмечаются молча (silent)
 */
export function dueDeadlineAlerts(tasks: Task[], a: DeadlineAlert, now = nowStamp()): { task: Task; silent: boolean }[] {
  const n = now.slice(0, 16);
  return tasks
    .filter((x) => x.deadline && !x.deadline_notified && open(x) && alertAt(x.deadline, a) <= n)
    .map((task) => ({ task, silent: !a.on || deadlineEnd(task.deadline!) < n }));
}

/** Заголовок уведомления: «Дедлайн завтра в 18:00», «Дедлайн через 3 дня» */
export function alertTitle(deadline: string, now = nowStamp()): string {
  const n = daysBetween(stampDay(now), stampDay(deadline));
  const when = n <= 0 ? "сегодня" : n === 1 ? "завтра" : n === 2 ? "послезавтра" : `через ${n} ${n < 5 ? "дня" : "дней"}`;
  const time = deadlineTime(deadline);
  return `Дедлайн ${when}${time ? ` в ${time}` : ""}`;
}

/** Следующему повтору дедлайн сдвигается на столько же дней, на сколько сдвинулась дата */
export function shiftDeadline(deadline: string | null, from: string | null, to: string): string | null {
  if (!deadline || !from) return null;
  const day = addDays(stampDay(deadline), daysBetween(from, to));
  return makeDeadline(day, deadlineTime(deadline));
}
