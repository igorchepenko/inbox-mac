// Все даты и время в одном месте. Храним в местном времени строками: день YYYY-MM-DD, момент YYYY-MM-DDTHH:MM[:SS],
// время дня HH:MM. Функции чистые (кроме тех, что берут «сегодня» и «сейчас»), их удобно проверять тестами.

export const pad = (n: number) => String(n).padStart(2, "0");

// Дни

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return dayKey(new Date());
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Сколько дней от from до to (to позже — положительное) */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

/** День недели с понедельника: 0 Пн … 6 Вс */
export const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7;
/** День недели по ISO: 1 Пн … 7 Вс, так он хранится в правилах повтора */
export const isoWeekday = (d: Date) => weekdayIndex(d) + 1;
export const isWeekend = (day: string) => weekdayIndex(parseDay(day)) >= 5;

/** Число дней в месяце; месяц с нуля, как в Date */
export const daysInMonth = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();

/** Понедельник недели, в которую входит день */
export function weekStart(day: string): string {
  return addDays(day, -weekdayIndex(parseDay(day)));
}

/** Первое число месяца, в который входит день */
export const monthStart = (day: string) => `${day.slice(0, 8)}01`;

/** Последнее число месяца, в который входит день */
export function monthEnd(day: string): string {
  const d = parseDay(day);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), daysInMonth(d.getFullYear(), d.getMonth())));
}

/** Первое число месяца через n месяцев от дня */
export function addMonths(day: string, n: number): string {
  const d = parseDay(day);
  return dayKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

/** Ближайший понедельник после сегодняшнего дня */
export function nextMonday(from = today()): string {
  return addDays(weekStart(from), 7);
}

// Моменты

export function nowStamp(): string {
  const d = new Date();
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** День момента: «2026-10-10T09:30» → «2026-10-10» */
export const stampDay = (stamp: string) => stamp.slice(0, 10);
/** Время момента: «2026-10-10T09:30» → «09:30» */
export const stampTime = (stamp: string) => stamp.slice(11, 16);

/** Часы между двумя моментами или днями, не меньше нуля */
export function hoursBetween(a: string, b: string): number {
  const p = (s: string) => new Date(s.length > 10 ? s : `${s}T00:00`).getTime();
  return Math.max(0, (p(b) - p(a)) / 3_600_000);
}

// Время дня

/** Последняя минута дня. Конец дня в базе хранится как 23:59, чтобы не появлялось «24:00» */
export const DAY_END = 24 * 60;

/** «09:30» или «9:30» → минуты от полуночи */
export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Минуты → «09:30». Конец дня и дальше — «23:59» */
export const toHHMM = (m: number) => (m >= DAY_END ? "23:59" : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);

/** Минуты → «9:30», без ведущего нуля у часа */
export const fmtMin = (m: number) => `${Math.floor(m / 60)}:${pad(m % 60)}`;

/** «45 мин», «1 ч», «1 ч 30 мин» */
export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return [h && `${h} ч`, m && `${m} мин`].filter(Boolean).join(" ") || "0 мин";
}

/** «10:00–11:30» для строки списка; без конца — просто начало */
export function fmtRange(start: string | null, end: string | null): string {
  return start ? (end ? `${start}–${end}` : start) : "";
}

// Названия

export const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
/** Месяц в родительном падеже: «9 октября» */
export const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
/** Короткие дни недели с понедельника, как в сетке календаря */
export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAYS_LONG = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

export const weekdayShort = (day: string) => WEEKDAYS[weekdayIndex(parseDay(day))];

/** «9 октября» */
export const dayMonth = (d: Date) => `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;

/** «Пятница, 9 октября» */
export const longDate = (d: Date) => `${WEEKDAYS_LONG[weekdayIndex(d)]}, ${dayMonth(d)}`;

/** «Сегодня», «Завтра», «Вчера» или «Пт, 9 окт», с годом, если он не текущий */
export function fmtDay(day: string): string {
  const t = today();
  if (day === t) return "Сегодня";
  if (day === addDays(t, 1)) return "Завтра";
  if (day === addDays(t, -1)) return "Вчера";
  const d = parseDay(day);
  const s = `${WEEKDAYS[weekdayIndex(d)]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? s : `${s} ${d.getFullYear()}`;
}
