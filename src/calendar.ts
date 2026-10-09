// Логика календаря без интерфейса: какие задачи попадают в видимые дни, повторы, раскладка пересекающихся.
import type { Task } from "./db";
import { addDays, dayKey, parseDay, today } from "./dates";
import { nextOccurrence, parseRule } from "./recurrence";

export type CalMode = "day" | "week" | "month";

/** Шаг перетаскивания и растягивания, минут */
export const STEP = 15;
/** Длительность, с которой показывается задача без времени окончания */
export const DEFAULT_LEN = 30;
const DAY_END = 24 * 60;

export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const pad = (n: number) => String(n).padStart(2, "0");
/** Минуты в HH:MM. Конец дня в базе хранится как 23:59, чтобы не появлялось «24:00» */
export const toHHMM = (m: number) => (m >= DAY_END ? "23:59" : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
/** Для подписей: 23:59 показывается как 24:00 */
export const label = (m: number) => (m >= DAY_END - 1 ? "24:00" : toHHMM(m));
export const snap = (m: number) => Math.round(m / STEP) * STEP;

/** Понедельник недели, в которую входит день */
export function weekStart(day: string): string {
  const d = parseDay(day);
  return addDays(day, -((d.getDay() + 6) % 7));
}

/** Видимые дни: один, семь или шесть недель месяца с понедельника */
export function rangeFor(mode: CalMode, anchor: string): string[] {
  if (mode === "day") return [anchor];
  if (mode === "week") {
    const s = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  const d = parseDay(anchor);
  const s = weekStart(dayKey(new Date(d.getFullYear(), d.getMonth(), 1)));
  return Array.from({ length: 42 }, (_, i) => addDays(s, i));
}

/** Куда листать стрелками */
export function shiftAnchor(mode: CalMode, anchor: string, dir: number): string {
  if (mode === "day") return addDays(anchor, dir);
  if (mode === "week") return addDays(anchor, 7 * dir);
  const d = parseDay(anchor);
  return dayKey(new Date(d.getFullYear(), d.getMonth() + dir, 1));
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MON_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WD_LONG = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

/** Заголовок: «Октябрь 2026», «6 – 12 октября», «Пятница, 9 октября» */
export function titleFor(mode: CalMode, anchor: string): string {
  const d = parseDay(anchor);
  const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  if (mode === "month") return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (mode === "day") return `${WD_LONG[d.getDay()]}, ${d.getDate()} ${MON_GEN[d.getMonth()]}${year}`;
  const days = rangeFor("week", anchor);
  const a = parseDay(days[0]), b = parseDay(days[6]);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${MON_GEN[b.getMonth()]}${year}`
    : `${a.getDate()} ${MON_GEN[a.getMonth()]} – ${b.getDate()} ${MON_GEN[b.getMonth()]}${year}`;
}

/** Одна плашка в календаре. Повтор из будущего — не отдельная задача, а проекция правила */
export interface Item {
  key: string;
  task: Task;
  day: string;
  start: number | null; // минуты от полуночи; null — задача на весь день, без времени
  end: number | null;
  virtual: boolean; // будущий повтор, которого ещё нет в базе
  done: boolean;
}

function itemOf(task: Task, day: string, virtual: boolean): Item {
  const start = task.start_time ? toMin(task.start_time) : null;
  let end = start != null && task.end_time ? toMin(task.end_time) : null;
  if (start != null && (end == null || end <= start)) end = Math.min(start + DEFAULT_LEN, DAY_END);
  if (end === DAY_END - 1) end = DAY_END;
  return {
    key: virtual ? `${task.id}@${day}` : String(task.id),
    task, day, start, end, virtual,
    done: task.status === "done" || task.status === "archived",
  };
}

/**
 * Задачи с датой в видимых днях. У открытой повторяющейся задачи будущие повторы показываются по правилу,
 * как будто каждый будет сделан в свой день. Прошлые повторы видны как обычные сделанные задачи из базы.
 */
export function itemsFor(tasks: Task[], days: string[]): Item[] {
  if (!days.length) return [];
  const from = days[0], to = days[days.length - 1];
  const out: Item[] = [];
  for (const x of tasks) {
    if (!x.due_date) continue;
    if (x.due_date >= from && x.due_date <= to) out.push(itemOf(x, x.due_date, false));
    const rule = x.status === "active" || x.status === "inbox" ? parseRule(x.recurrence) : null;
    if (!rule) continue;
    let cur = { date: x.due_date, rule };
    for (let i = 0; i < 500; i++) {
      // День выполнения = день повтора: так считаются и правила «от выполнения»
      const next = nextOccurrence(cur.rule, cur.date, cur.date < today() ? today() : cur.date);
      if (!next || next.date > to || next.date <= cur.date) break;
      if (next.date >= from) out.push(itemOf(x, next.date, true));
      cur = next;
    }
  }
  return out;
}

export interface Placed extends Item {
  col: number; // колонка внутри группы пересекающихся
  cols: number; // сколько колонок в группе
}

/** Раскладка задач одного дня: пересекающиеся встают рядом, каждая в своей колонке */
export function layoutDay(items: Item[]): Placed[] {
  const timed = items.filter((i) => i.start != null).sort((a, b) => a.start! - b.start! || b.end! - a.end!);
  const out: Placed[] = [];
  let group: Placed[] = [];
  let colEnds: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    for (const p of group) p.cols = colEnds.length;
    out.push(...group);
    group = [];
    colEnds = [];
  };
  for (const it of timed) {
    if (it.start! >= groupEnd) flush();
    let col = colEnds.findIndex((e) => e <= it.start!);
    if (col < 0) col = colEnds.push(0) - 1;
    // Совсем короткие задачи рисуются минимум на 15 минут, раскладка учитывает именно это
    colEnds[col] = Math.max(it.end!, it.start! + STEP);
    groupEnd = Math.max(groupEnd, colEnds[col]);
    group.push({ ...it, col, cols: 1 });
  }
  flush();
  return out;
}

/** Порядок плашек без времени и в ячейке месяца: открытые раньше сделанных, по времени, по важности */
export function byDayOrder(a: Item, b: Item): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const as = a.start ?? -1, bs = b.start ?? -1;
  if (as !== bs) return as - bs;
  return b.task.priority - a.task.priority || a.task.id - b.task.id;
}

/** Можно ли двигать: только настоящие открытые задачи, а не проекции повторов и не архив */
export const movable = (it: Item) => !it.virtual && (it.task.status === "active" || it.task.status === "inbox");
