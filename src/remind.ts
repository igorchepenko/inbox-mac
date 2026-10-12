import type { Task } from "./db";
import { addDays, dayKey, daysBetween, fmtDay, pad, stampDay, stampTime, today } from "./dates";
import { pref } from "./prefs";

/*
 * Напоминание о задаче. Считается от даты и начала задачи: «за 15 минут», «за 1 день».
 * Своё время — конкретный момент, тогда remind_before пустой. В базе всегда лежит готовый момент remind_at,
 * его и ждут уведомления. Чистая логика под тесты.
 */

/** Варианты «за сколько», в минутах, по порядку в списке */
export const REMIND_BEFORE: { value: number; name: string }[] = [
  { value: 5, name: "за 5 минут" },
  { value: 15, name: "за 15 минут" },
  { value: 30, name: "за 30 минут" },
  { value: 60, name: "за 1 час" },
  { value: 1440, name: "за 1 день" },
];

/** У задачи без времени напоминание считается от 9:00 её дня */
export const DAY_ANCHOR = "09:00";

/** От какого времени считать «за 15 минут»: от начала, а если указан только конец (срок) — от него */
export const anchorOf = (x: { start_time: string | null; end_time?: string | null }) => x.start_time ?? x.end_time ?? null;

/** За сколько минут напоминать, когда включают напоминание: из настроек, по умолчанию 15 */
export function defaultBefore(settings: Record<string, string>): number {
  const n = Number(pref(settings, "remind.before"));
  return REMIND_BEFORE.some((o) => o.value === n) ? n : 15;
}

export const beforeName = (m: number) => REMIND_BEFORE.find((o) => o.value === m)?.name ?? `за ${m} мин`;

/** Момент «YYYY-MM-DDTHH:MM» на m минут раньше. Через Date, чтобы переходы суток и месяцев считались сами */
export function minusMinutes(stamp: string, m: number): string {
  const [y, mo, d] = stamp.slice(0, 10).split("-").map(Number);
  const [h, mi] = stamp.slice(11, 16).split(":").map(Number);
  const x = new Date(y, mo - 1, d, h, mi - m);
  return `${dayKey(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

/** Когда напомнить, если напоминание «за m минут» до задачи в этот день и время */
export const remindAtFor = (due: string, start: string | null, before: number) => minusMinutes(`${due}T${start ?? DAY_ANCHOR}`, before);

export type When = Pick<Task, "due_date" | "start_time" | "remind_at" | "remind_before"> & { end_time?: string | null };
export type RemindPatch = Partial<Pick<Task, "remind_at" | "remind_before" | "reminded">>;

/**
 * Напоминание после того, как у задачи сменили дату или начало. «За 15 минут» пересчитывается от нового времени,
 * своё время сдвигается на столько же дней, на сколько сдвинулась дата. Без напоминания пустой объект
 */
export function remindPatch(x: When, next: Partial<Pick<Task, "due_date" | "start_time" | "end_time">>): RemindPatch {
  if (!x.remind_at) return {};
  const day = (next.due_date !== undefined ? next.due_date : x.due_date) ?? today();
  const start = next.start_time !== undefined ? next.start_time : x.start_time;
  const end = next.end_time !== undefined ? next.end_time : x.end_time;
  if (x.remind_before != null) return { remind_at: remindAtFor(day, anchorOf({ start_time: start, end_time: end }), x.remind_before), reminded: 0 };
  const rDay = x.due_date ? addDays(stampDay(x.remind_at), daysBetween(x.due_date, day)) : day;
  return { remind_at: `${rDay}T${stampTime(x.remind_at)}`, reminded: 0 };
}

/** Включить напоминание «за m минут» или сменить вариант. Задача без даты получает сегодняшнюю */
export function setBefore(x: When, before: number): RemindPatch & Partial<Pick<Task, "due_date">> {
  const day = x.due_date ?? today();
  return { ...(x.due_date ? {} : { due_date: day }), remind_before: before, remind_at: remindAtFor(day, anchorOf(x), before), reminded: 0 };
}

/** Своё время: момент остаётся тем же, что был посчитан, дальше его день и время правят вручную */
export function setCustom(x: When, time?: string, day?: string): RemindPatch & Partial<Pick<Task, "due_date">> {
  const due = x.due_date ?? today();
  const at = x.remind_at ?? `${due}T${anchorOf(x) ?? DAY_ANCHOR}`;
  return { ...(x.due_date ? {} : { due_date: due }), remind_before: null, remind_at: `${day ?? stampDay(at)}T${time ?? stampTime(at)}`, reminded: 0 };
}

export const REMIND_OFF: RemindPatch = { remind_at: null, remind_before: null, reminded: 0 };

/** Подпись: «за 15 минут, Сегодня 13:45» или «Завтра 10:00» для своего времени */
export function remindText(x: When): string {
  if (!x.remind_at) return "";
  const at = `${fmtDay(stampDay(x.remind_at))} ${stampTime(x.remind_at)}`;
  return x.remind_before != null ? `${beforeName(x.remind_before)}, ${at}` : at;
}
