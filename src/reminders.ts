import { invoke } from "@tauri-apps/api/core";
import { setSetting, updateTask, type Task } from "./db";
import { today } from "./dates";
import { pref } from "./prefs";
import { activeProfile } from "./profile";
import { digestBody, digestKey, dueReminders, msOf, planDigest, planReminders, reminderKey, reminderText, type Planned } from "./notifyPlan";

/*
 * Уведомления. Показывает их Rust через центр уведомлений macOS (src-tauri/src/notify.rs).
 * Будущие напоминания и сводка заранее стоят в расписании macOS, поэтому приходят вовремя, даже когда окно Inbox
 * спрятано и его JavaScript спит. Раз в 30 секунд главное окно отмечает наступившие напоминания в базе
 * и показывает сами те, что macOS не успела получить в расписание (например, поставленные на ближайшую минуту).
 */

const STALE_MS = 12 * 60 * 60 * 1000;
const DIGEST_LATE_MS = 3 * 60 * 60 * 1000;

/** Звук из настроек: имя системного звука или ничего */
function soundOf(settings: Record<string, string>): string | null {
  const s = pref(settings, "remind.sound");
  return s === "none" ? null : s;
}

/** Что ушло в расписание macOS. Хранится в браузере окна: одно на все профили, как и расписание */
const SCHEDULED = "notify.scheduled";
const profileKey = (key: string) => `${activeProfile()}:${key}`;
function scheduled(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SCHEDULED) ?? "[]"));
  } catch {
    return new Set();
  }
}

/** Разрешение macOS на уведомления: granted, denied, unknown (ещё не спрашивали) или unsupported */
export async function permission(ask: boolean): Promise<string> {
  return invoke<string>("notify_status", { ask });
}

export async function ensurePermission(): Promise<boolean> {
  try {
    return (await permission(true)) === "granted";
  } catch {
    return false;
  }
}

/** Показать уведомление сейчас. Ошибку macOS отдаёт наверх */
export async function notify(settings: Record<string, string>, title: string, body: string): Promise<void> {
  await invoke("notify_send", { title, body, sound: soundOf(settings) });
}

let lastPlan = "";
let queue = Promise.resolve();

/**
 * Отдать macOS расписание: все будущие напоминания и сегодняшнюю сводку. Вызывается после каждого чтения базы,
 * но macOS дёргаем, только когда расписание поменялось. Выключенные уведомления снимают всё.
 * Вызовы идут по очереди, чтобы два чтения подряд не переставляли расписание наперегонки
 */
export function syncPlan(tasks: Task[], settings: Record<string, string>): Promise<void> {
  queue = queue.then(() => replan(tasks, settings)).catch(() => {});
  return queue;
}

async function replan(tasks: Task[], settings: Record<string, string>): Promise<void> {
  const now = Date.now();
  const on = pref(settings, "remind.enabled") === "1";
  const digest = on ? planDigest(tasks, settings, now) : null;
  const items: Planned[] = on ? [...planReminders(tasks, now), ...(digest ? [digest] : [])] : [];
  const sound = soundOf(settings);
  const sig = JSON.stringify([activeProfile(), sound, items]);
  if (sig === lastPlan) return;
  if (items.length && !(await ensurePermission())) return;
  try {
    await invoke("notify_plan", {
      items: items.map((i) => ({ key: profileKey(i.key), title: i.title, body: i.body, delay: (i.at - Date.now()) / 1000 })),
      sound,
    });
  } catch {
    return; // попробуем при следующем чтении базы
  }
  lastPlan = sig;
  // Наступившие, но ещё не отмеченные в базе остаются в списке: их показала macOS, повторять не надо
  const before = scheduled();
  const keep = dueReminders(tasks, Date.now()).map((x) => profileKey(reminderKey(x))).filter((k) => before.has(k));
  if (before.has(profileKey(digestKey()))) keep.push(profileKey(digestKey()));
  try {
    localStorage.setItem(SCHEDULED, JSON.stringify([...keep, ...items.map((i) => profileKey(i.key))]));
  } catch {
    // без localStorage напоминание в худшем случае придёт дважды
  }
}

/**
 * Отмечает наступившие напоминания. Показывает сама только те, что не стояли в расписании macOS.
 * Напоминания старше 12 часов (Мак был выключен) гасим молча, чтобы не завалить уведомлениями.
 * Возвращает true, если что-то поменялось в базе.
 */
export async function fireDueReminders(tasks: Task[], settings: Record<string, string>): Promise<boolean> {
  const now = Date.now();
  const due = dueReminders(tasks, now);
  if (!due.length) return false;
  const enabled = pref(settings, "remind.enabled") === "1";
  const byMac = scheduled();
  let allowed: boolean | null = null;
  for (const x of due) {
    const fresh = now - msOf(x.remind_at!) < STALE_MS;
    if (enabled && fresh && !byMac.has(profileKey(reminderKey(x)))) {
      allowed ??= await ensurePermission();
      const { title, body } = reminderText(x);
      if (allowed) await notify(settings, title, body).catch(() => {});
    }
    await updateTask(x.id, { reminded: 1 });
  }
  return true;
}

/**
 * Утренняя сводка: раз в день в выбранное время, сколько задач на сегодня и сколько ждут разбора.
 * Обычно её показывает macOS по расписанию; здесь только отметка, что сегодня она была, и запасной показ.
 * Если Мак проснулся позже чем через 3 часа после этого времени, сводку за этот день пропускаем.
 */
export async function maybeSendDigest(tasks: Task[], settings: Record<string, string>): Promise<boolean> {
  if (pref(settings, "digest.enabled") !== "1" || pref(settings, "remind.enabled") !== "1") return false;
  const t = today();
  if (settings["digest.last"] === t) return false;
  const late = Date.now() - msOf(`${t}T${pref(settings, "digest.time")}`);
  if (late < 0) return false;
  await setSetting("digest.last", t);
  const body = digestBody(tasks);
  if (scheduled().has(profileKey(digestKey(t))) || late > DIGEST_LATE_MS || !body || !(await ensurePermission())) return true;
  await notify(settings, "План на день", body).catch(() => {});
  return true;
}
