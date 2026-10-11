import type { Task } from "./db";
import { today } from "./dates";
import { pref } from "./prefs";
import { beforeName } from "./remind";
import { countFor, plural } from "./views";

/*
 * Что и когда показать уведомлением. Чистая логика под тесты: reminders.ts отдаёт будущие уведомления
 * в расписание macOS, а наступившие отмечает в базе.
 */

export interface Planned {
  /** Постоянный ключ: по нему macOS заменяет запланированное, а приложение узнаёт, что уже показано */
  key: string;
  /** Когда показать, миллисекунды */
  at: number;
  title: string;
  body: string;
}

const open = (x: Task) => x.status === "inbox" || x.status === "active";

/** Момент «YYYY-MM-DDTHH:MM» в миллисекундах, местное время */
export const msOf = (stamp: string) => new Date(stamp.slice(0, 16)).getTime();

export const reminderKey = (x: Task) => `r:${x.id}:${x.remind_at}`;

/** Текст уведомления: встреча помечена, «за 15 минут» превращается в «Через 15 минут, в 14:00» */
export function reminderText(x: Task): { title: string; body: string } {
  const title = x.kind === "meeting" ? `Встреча: ${x.title}` : x.title;
  const when = x.remind_before != null && x.start_time ? `Через ${beforeName(x.remind_before).slice(3)}, в ${x.start_time}` : "";
  const body = [when, x.note.trim().split("\n")[0]].filter(Boolean).join(" · ") || "Напоминание из Inbox";
  return { title, body };
}

/** Напоминания, время которых ещё не пришло: их ставим в расписание macOS */
export function planReminders(tasks: Task[], now: number): Planned[] {
  return tasks
    .filter((x) => open(x) && x.remind_at && !x.reminded && msOf(x.remind_at) > now + 1000)
    .map((x) => ({ key: reminderKey(x), at: msOf(x.remind_at!), ...reminderText(x) }));
}

/** Напоминания, время которых наступило, а в базе они ещё не отмечены */
export function dueReminders(tasks: Task[], now: number): Task[] {
  return tasks.filter((x) => open(x) && x.remind_at && !x.reminded && msOf(x.remind_at) <= now);
}

export const digestKey = (day = today()) => `d:${day}`;

/** Текст утренней сводки или пустая строка, если сказать нечего */
export function digestBody(tasks: Task[]): string {
  const todayN = countFor("today", tasks);
  const inboxN = countFor("inbox", tasks);
  const parts = [todayN && `на сегодня ${plural(todayN, "задача", "задачи", "задач")}`, inboxN && `на разборе ${inboxN}`];
  const body = parts.filter(Boolean).join(", ");
  return body && body.charAt(0).toUpperCase() + body.slice(1);
}

/** Сегодняшняя сводка, если она включена, ещё не пришла и её время впереди */
export function planDigest(tasks: Task[], settings: Record<string, string>, now: number): Planned | null {
  const t = today();
  if (pref(settings, "digest.enabled") !== "1" || settings["digest.last"] === t) return null;
  const at = msOf(`${t}T${pref(settings, "digest.time")}`);
  const body = digestBody(tasks);
  return at > now + 1000 && body ? { key: digestKey(t), at, title: "План на день", body } : null;
}
