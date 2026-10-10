// Логика календаря без интерфейса: какие задачи попадают в видимые дни, повторы, раскладка пересекающихся.
import type { Task } from "./db";
import { addDays, addMonths, DAY_END, dayMonth, longDate, monthStart, MONTHS, parseDay, today, toHHMM, toMin, weekStart } from "./dates";
import { nextOccurrence, parseRule } from "./recurrence";

export type CalMode = "day" | "week" | "month";

/** Шаг перетаскивания и растягивания, минут */
export const STEP = 15;
/** Длительность, с которой показывается задача без времени окончания */
export const DEFAULT_LEN = 30;

/** Для подписей: 23:59 показывается как 24:00 */
export const label = (m: number) => (m >= DAY_END - 1 ? "24:00" : toHHMM(m));
export const snap = (m: number) => Math.round(m / STEP) * STEP;

/** Видимые дни: один, семь или шесть недель месяца с понедельника */
export function rangeFor(mode: CalMode, anchor: string): string[] {
  if (mode === "day") return [anchor];
  if (mode === "week") {
    const s = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  const s = weekStart(monthStart(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(s, i));
}

/** Куда листать стрелками */
export function shiftAnchor(mode: CalMode, anchor: string, dir: number): string {
  if (mode === "day") return addDays(anchor, dir);
  if (mode === "week") return addDays(anchor, 7 * dir);
  return addMonths(anchor, dir);
}

/** Заголовок: «Октябрь 2026», «6 – 12 октября», «Пятница, 9 октября» */
export function titleFor(mode: CalMode, anchor: string): string {
  const d = parseDay(anchor);
  const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  if (mode === "month") return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (mode === "day") return `${longDate(d)}${year}`;
  const days = rangeFor("week", anchor);
  const a = parseDay(days[0]), b = parseDay(days[6]);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${dayMonth(b)}${year}`
    : `${dayMonth(a)} – ${dayMonth(b)}${year}`;
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
  left: number; // доля ширины колонки дня, 0…1
  width: number; // доля ширины колонки дня
  z: number; // кто позже начался, лежит выше
}

/** Начались почти одновременно: заголовок нижней не виден, поэтому такие встают рядом, а не внахлёст */
const NEAR = 30;
/** На сколько сдвигается вправо задача, которая легла поверх более ранней */
const INDENT = 0.4;

/**
 * Раскладка задач одного дня, как в Google Календаре. Задача, начавшаяся позже, ложится поверх более ранней
 * со сдвигом вправо и тянется до правого края: у нижней остаётся видна верхняя часть с названием и полоска слева.
 * Задачи, начавшиеся почти одновременно (меньше 30 минут разницы), делят ширину поровну и стоят рядом.
 */
export function layoutDay(items: Item[]): Placed[] {
  const timed = items.filter((i) => i.start != null).sort((a, b) => a.start! - b.start! || b.end! - a.end!);
  const out: Placed[] = [];
  const bottom = new Map<Placed, number>(); // совсем короткие задачи рисуются минимум на 15 минут
  const clusters: { start: number; left: number; members: Placed[] }[] = [];
  const running = (at: number) => out.filter((p) => bottom.get(p)! > at);
  timed.forEach((it, i) => {
    const start = it.start!;
    const now = running(start);
    const cl = clusters.find((c) => start - c.start < NEAR && c.members.some((m) => now.includes(m)));
    const placed: Placed = { ...it, left: 0, width: 1, z: i + 1 };
    bottom.set(placed, Math.max(it.end!, start + STEP));
    out.push(placed);
    if (cl) {
      cl.members.push(placed);
      const w = (1 - cl.left) / cl.members.length;
      cl.members.forEach((m, k) => ((m.left = cl.left + k * w), (m.width = w)));
      return;
    }
    const under = now.filter((p) => !clusters.some((c) => c.members.includes(p) && start - c.start < NEAR));
    const base = under.length ? Math.max(...under.map((p) => p.left)) : -1;
    placed.left = base < 0 ? 0 : Math.min(0.75, base + (1 - base) * INDENT);
    placed.width = 1 - placed.left;
    clusters.push({ start, left: placed.left, members: [placed] });
  });
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
