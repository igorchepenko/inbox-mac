import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { updateTask, type Task } from "./db";
import { nowStamp } from "./dates";

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
export async function fireDueReminders(tasks: Task[]): Promise<boolean> {
  const now = nowStamp().slice(0, 16);
  const due = tasks.filter(
    (x) => x.remind_at && !x.reminded && (x.status === "inbox" || x.status === "active") && x.remind_at <= now,
  );
  if (!due.length) return false;
  const allowed = await ensurePermission();
  for (const x of due) {
    const fresh = Date.now() - new Date(x.remind_at!).getTime() < STALE_MS;
    if (allowed && fresh) sendNotification({ title: x.title, body: x.note || "Напоминание из Inbox" });
    await updateTask(x.id, { reminded: 1 });
  }
  return true;
}
