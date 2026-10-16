import type { Task } from "./db";
import { isClosed } from "./db";
import { addDays, today } from "./dates";

/*
 * Статус «Жду»: задача ждёт ответа или результата от человека (waiting_for). Это не этап канбана и не тег:
 * этап (Новые, К выполнению, Готово) у задачи остаётся прежним, «Жду» накладывается поверх.
 * Ждущая задача уходит из «Сегодня» и «Скоро», живёт в умном списке «Жду». В день напоминания (waiting_until)
 * она возвращается в «Сегодня» с пометкой «пора напомнить». Чистая логика под тесты.
 */

type W = Pick<Task, "status" | "waiting_for" | "waiting_until">;

/** Ждёт кого-то: открытая задача с именем в «Жду». Закрытая никого не ждёт */
export const isWaiting = (x: W) => !isClosed(x) && !!x.waiting_for;

/** Пора напомнить: ждём, и день напоминания наступил или прошёл */
export const pingDue = (x: W, t = today()) => isWaiting(x) && !!x.waiting_until && x.waiting_until <= t;

/** Быстрые сроки напоминания: через сколько дней спросить */
export const WAIT_PRESETS: { days: number; name: string }[] = [
  { days: 2, name: "Через 2 дня" },
  { days: 7, name: "Через неделю" },
];
export const presetDate = (days: number, t = today()) => addDays(t, days);

/** Снять статус: ответ пришёл, задача снова в работе */
export const CLEAR_WAITING = { waiting_for: null, waiting_until: null } as const;
