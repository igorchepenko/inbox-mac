import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { setSetting, updateTask, type Task } from "./db";
import { nowStamp, today } from "./dates";
import { pref } from "./prefs";
import { countFor, plural } from "./views";
import { alertOf, alertTitle, dueDeadlineAlerts } from "./deadline";

const STALE_MS = 12 * 60 * 60 * 1000;

export async function ensurePermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/**
 * Проверяет напоминания, время которых наступило. Главное окно вызывает её раз в 30 секунд,
 * поэтому уведомление приходит с точностью до минуты, пока Inbox запущен (хотя бы в строке меню).
 * Напоминания старше 12 часов (Мак был выключен) гасим молча, чтобы не завалить уведомлениями.
 * Возвращает true, если что-то поменялось в базе.
 */
/** Звук из настроек: имя системного звука или ничего */
function soundOf(settings: Record<string, string>): string | undefined {
  const s = pref(settings, "remind.sound");
  return s === "none" ? undefined : s;
}

export function notify(settings: Record<string, string>, title: string, body: string) {
  sendNotification({ title, body, sound: soundOf(settings) });
}

export async function fireDueReminders(tasks: Task[], settings: Record<string, string>): Promise<boolean> {
  const now = nowStamp().slice(0, 16);
  const due = tasks.filter(
    (x) => x.remind_at && !x.reminded && (x.status === "inbox" || x.status === "active") && x.remind_at <= now,
  );
  if (!due.length) return false;
  // Уведомления выключены в настройках: напоминания проходят молча
  const enabled = pref(settings, "remind.enabled") === "1";
  const allowed = enabled && (await ensurePermission());
  for (const x of due) {
    const fresh = Date.now() - new Date(x.remind_at!).getTime() < STALE_MS;
    if (allowed && fresh) notify(settings, x.title, x.note || "Напоминание из Inbox");
    await updateTask(x.id, { reminded: 1 });
  }
  return true;
}

/**
 * Уведомления о дедлайнах: за сколько дней и во сколько, задаётся в настройках (по умолчанию за день в 10:00).
 * Каждая задача уведомляет один раз; если дедлайн уже прошёл, пока Мак спал, отмечаем молча.
 * Возвращает true, если что-то поменялось в базе.
 */
export async function fireDeadlineAlerts(tasks: Task[], settings: Record<string, string>): Promise<boolean> {
  const due = dueDeadlineAlerts(tasks, alertOf(settings));
  if (!due.length) return false;
  const allowed = pref(settings, "remind.enabled") === "1" && due.some((d) => !d.silent) && (await ensurePermission());
  for (const { task: x, silent } of due) {
    if (allowed && !silent) notify(settings, alertTitle(x.deadline!), x.title);
    await updateTask(x.id, { deadline_notified: 1 });
  }
  return true;
}

const DIGEST_LATE_MS = 3 * 60 * 60 * 1000;

/**
 * Утренняя сводка: раз в день в выбранное время, сколько задач на сегодня и сколько ждут разбора.
 * Если Мак проснулся позже чем через 3 часа после этого времени, сводку за этот день пропускаем.
 */
export async function maybeSendDigest(tasks: Task[], settings: Record<string, string>): Promise<boolean> {
  if (pref(settings, "digest.enabled") !== "1" || pref(settings, "remind.enabled") !== "1") return false;
  const t = today();
  if (settings["digest.last"] === t) return false;
  const at = new Date(`${t}T${pref(settings, "digest.time")}:00`);
  const late = Date.now() - at.getTime();
  if (late < 0) return false;
  await setSetting("digest.last", t);
  const todayN = countFor("today", tasks);
  const inboxN = countFor("inbox", tasks);
  if (late > DIGEST_LATE_MS || !(todayN + inboxN) || !(await ensurePermission())) return true;
  const parts = [todayN && `на сегодня ${plural(todayN, "задача", "задачи", "задач")}`, inboxN && `на разборе ${inboxN}`];
  const body = parts.filter(Boolean).join(", ");
  notify(settings, "План на день", body.charAt(0).toUpperCase() + body.slice(1));
  return true;
}
