// Расчёты для главной: всё считается из задач на лету, отдельных таблиц для статистики нет
import type { Project, Task } from "../db";
import { addDays, parseDay, today } from "../dates";

export const BLOCKS = [
  { id: "summary", name: "Итоги дня", hint: "", span: 12 },
  { id: "today", name: "Сегодня", hint: "полоса дня и список", span: 8 },
  { id: "inbox", name: "На разбор", hint: "", span: 4 },
  { id: "week", name: "Ближайшие 7 дней", hint: "", span: 7 },
  { id: "matrix", name: "Матрица Эйзенхауэра", hint: "необязательно", span: 5 },
  { id: "stats", name: "Статистика", hint: "", span: 8 },
  { id: "projects", name: "Проекты", hint: "", span: 4 },
] as const;

export type BlockId = (typeof BLOCKS)[number]["id"];
export const DEFAULT_ORDER: BlockId[] = BLOCKS.map((b) => b.id);

// Ключи в таблице settings. Окно настроек может менять рабочий день, ёмкость и цель
export const KEY_ORDER = "home:order";
export const KEY_HIDDEN = "home:hidden";

function parseIds(json: string | undefined): BlockId[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((k): k is BlockId => DEFAULT_ORDER.includes(k)) : [];
  } catch {
    return [];
  }
}

/** Сохранённый порядок; блоки, которых в нём нет (появились позже), встают в конец */
export function blockOrder(settings: Record<string, string>): BlockId[] {
  const saved = [...new Set(parseIds(settings[KEY_ORDER]))];
  return [...saved, ...DEFAULT_ORDER.filter((k) => !saved.includes(k))];
}

export function hiddenBlocks(settings: Record<string, string>): BlockId[] {
  return parseIds(settings[KEY_HIDDEN]);
}

/** Ширины по 12 колонкам: если следующий блок не помещается в ряд, предыдущий растягивается до конца ряда */
export function fillRows(spans: number[]): number[] {
  const out = [...spans];
  let used = 0;
  for (let i = 0; i < out.length; i++) {
    if (used + out[i] > 12) {
      out[i - 1] += 12 - used;
      used = 0;
    }
    used = (used + out[i]) % 12;
  }
  if (used) out[out.length - 1] += 12 - used;
  return out;
}

export interface DayConfig {
  start: number; // минуты от полуночи
  end: number;
  capacity: number; // сколько минут дня можно занять задачами
  goal: number; // цель: сделанных задач в день
}

export function dayConfig(settings: Record<string, string>): DayConfig {
  const num = (k: string, def: number, min: number, max: number) => {
    const n = Number(settings[k]);
    return Number.isFinite(n) && settings[k] !== undefined && n >= min && n <= max ? n : def;
  };
  const start = num("home:day_start", 9, 0, 23);
  const end = num("home:day_end", 20, start + 1, 24);
  return { start: start * 60, end: end * 60, capacity: num("home:capacity", 6, 1, 24) * 60, goal: num("home:goal", 5, 1, 100) };
}

// Время и длительность

export const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
export const fmtMin = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

/** Задача без конца занимает полчаса */
export function duration(x: Task): number {
  if (!x.start_time) return 0;
  const d = x.end_time ? mins(x.end_time) - mins(x.start_time) : 30;
  return d > 0 ? d : 30;
}

export function fmtDur(m: number): string {
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ""}`;
}

export const timeRange = (x: Task) => (x.start_time ? `${x.start_time}–${fmtMin(mins(x.start_time) + duration(x))}` : "");

// Состояния задач

export const isDone = (x: Task) => x.status === "done" || x.status === "archived";
const doneDay = (x: Task) => (isDone(x) && x.done_at ? x.done_at.slice(0, 10) : null);
const byStart = (a: Task, b: Task) => (a.start_time ?? "99") < (b.start_time ?? "99") ? -1 : (a.start_time ?? "99") > (b.start_time ?? "99") ? 1 : 0;

/** Задачи дня: разобранные с этой датой, открытые и сделанные */
export function dayTasks(tasks: Task[], day: string): Task[] {
  return tasks.filter((x) => x.status !== "inbox" && x.due_date === day).sort(byStart);
}

export function overdue(tasks: Task[]): Task[] {
  const t = today();
  return tasks.filter((x) => x.status === "active" && !!x.due_date && x.due_date < t)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));
}

/** Сегодняшнее: открытые на сегодня и всё, что сделано сегодня (кроме сделанного заранее за будущие дни) */
export function todayItems(tasks: Task[]): Task[] {
  const t = today();
  return tasks
    .filter((x) => (x.status === "active" && x.due_date === t) || (doneDay(x) === t && (x.due_date ?? "") <= t))
    .sort(byStart);
}

export const busyMinutes = (items: Task[]) => items.reduce((s, x) => s + duration(x), 0);

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

// Итоги дня

export interface Summary {
  inbox: number;
  triagedToday: number;
  planned: number;
  doneToday: number;
  busy: number;
}

export function summary(tasks: Task[]): Summary {
  const t = today();
  const items = todayItems(tasks);
  return {
    inbox: tasks.filter((x) => x.status === "inbox").length,
    triagedToday: tasks.filter((x) => x.triaged_at?.slice(0, 10) === t).length,
    planned: items.length + overdue(tasks).length,
    doneToday: items.filter(isDone).length,
    busy: busyMinutes(items.filter((x) => x.due_date === t)),
  };
}

/**
 * Серия: сколько дней подряд «На разбор» опустевал. День чистый, если к его концу каждая записанная
 * до него задача уже покинула входящие (разобрана или сразу сделана). Сегодня считается, только когда пусто сейчас
 */
export function streak(tasks: Task[]): { days: number; week: boolean[] } {
  const t = today();
  if (!tasks.length) return { days: 0, week: Array(7).fill(false) };
  const first = tasks.reduce((m, x) => (x.created_at < m ? x.created_at : m), t).slice(0, 10);
  const left = tasks.map((x) => ({
    from: x.created_at.slice(0, 10),
    // Когда задача ушла из входящих; у ещё лежащих там — никогда
    out: x.status === "inbox" ? "9999" : (x.triaged_at ?? x.done_at ?? x.created_at).slice(0, 10),
  }));
  const clean = (day: string) => day >= first && !left.some((l) => l.from <= day && l.out > day);
  const week = Array.from({ length: 7 }, (_, i) => clean(addDays(t, i - 6)));
  let day = clean(t) ? t : addDays(t, -1), days = 0;
  while (days < 400 && clean(day)) days++, (day = addDays(day, -1));
  return { days, week };
}

// На разбор

export function inboxItems(tasks: Task[]): { task: Task; age: number }[] {
  const t = today();
  return tasks
    .filter((x) => x.status === "inbox")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .map((task) => ({ task, age: Math.max(0, daysBetween(task.created_at.slice(0, 10), t)) }));
}

export const fmtAge = (a: number) => (a === 0 ? "сегодня" : a === 1 ? "вчера" : `${a} дн`);

// Ближайшие 7 дней

export interface WeekDay {
  day: string;
  items: Task[];
  busy: number;
}

export function nextDays(tasks: Task[]): WeekDay[] {
  const t = today();
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(t, i + 1);
    const items = dayTasks(tasks, day);
    return { day, items, busy: busyMinutes(items) };
  });
}

/** Цвет полосы занятости: свободно, плотно, перегруз */
export const loadColor = (f: number) => (f < 0.4 ? "exercise" : f < 0.8 ? "stand" : "move");

// Матрица Эйзенхауэра

export const QUADRANTS = [
  // Те же чистые цвета, что у квадрантов в задаче (task.css)
  { q: 1, name: "Сделать сейчас", color: "q1" },
  { q: 2, name: "Запланировать", color: "q2" },
  { q: 3, name: "Делегировать", color: "q3" },
  { q: 4, name: "Убрать", color: "q4" },
] as const;

/** Открытые задачи на ближайшие 7 дней (и просроченные) с заданным квадрантом */
export function matrixTasks(tasks: Task[]): Task[] {
  const until = addDays(today(), 7);
  return tasks.filter((x) => x.status === "active" && x.quadrant != null && !!x.due_date && x.due_date <= until);
}

// Статистика

export type Period = "week" | "month";

export interface Bar {
  label: string;
  current: boolean;
  byProject: Map<number, number>; // 0 — без проекта
  total: number;
}

export interface Stats {
  bars: Bar[];
  goal: number;
  done: number;
  onTime: number | null; // доля сделанных в срок среди сделанных со сроком
  triage: number | null; // среднее от записи до разбора, часы
  planned: number; // минуты
}

const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function stampHours(a: string, b: string): number {
  const p = (s: string) => new Date(s.length > 10 ? s : `${s}T00:00`).getTime();
  return Math.max(0, (p(b) - p(a)) / 3_600_000);
}

export function stats(tasks: Task[], period: Period, cfg: DayConfig): Stats {
  const t = today();
  const n = period === "week" ? 7 : 4;
  const len = period === "week" ? 1 : 7;
  const from = addDays(t, -(n * len - 1));
  const bars: Bar[] = Array.from({ length: n }, (_, i) => {
    const start = addDays(from, i * len);
    const label = period === "week"
      ? i === n - 1 ? "Сег" : WD[parseDay(start).getDay()]
      : ["3 нед. назад", "2 нед. назад", "Прошлая", "Эта"][i];
    return { label, current: i === n - 1, byProject: new Map(), total: 0 };
  });
  const done = tasks.filter((x) => {
    const d = doneDay(x);
    return !!d && d >= from && d <= t;
  });
  for (const x of done) {
    const b = bars[Math.floor(daysBetween(from, doneDay(x)!) / len)];
    const k = x.project_id ?? 0;
    b.byProject.set(k, (b.byProject.get(k) ?? 0) + 1);
    b.total++;
  }
  const withDue = done.filter((x) => x.due_date);
  const triaged = tasks.filter((x) => x.triaged_at && x.triaged_at.slice(0, 10) >= from);
  // Запланированное: вся текущая неделя с понедельника или весь месяц
  const td = parseDay(t);
  const pFrom = period === "week" ? addDays(t, -((td.getDay() + 6) % 7)) : t.slice(0, 8) + "01";
  const pTo = period === "week" ? addDays(pFrom, 6) : addDays(addDays(pFrom, 31).slice(0, 8) + "01", -1);
  const planned = busyMinutes(tasks.filter((x) => x.status !== "inbox" && !!x.due_date && x.due_date >= pFrom && x.due_date <= pTo));
  return {
    bars,
    goal: period === "week" ? cfg.goal : cfg.goal * 5,
    done: done.length,
    onTime: withDue.length ? withDue.filter((x) => doneDay(x)! <= x.due_date!).length / withDue.length : null,
    triage: triaged.length ? triaged.reduce((s, x) => s + stampHours(x.created_at, x.triaged_at!), 0) / triaged.length : null,
    planned,
  };
}

export function fmtHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} мин`;
  if (h < 24) return `${Math.round(h)} ч`;
  return `${(h / 24).toFixed(1).replace(".", ",")} дн.`;
}

// Проекты

export interface ProjectStat {
  project: Project;
  open: number;
  overdue: number;
  done: number;
}

export function projectStats(tasks: Task[], projects: Project[]): ProjectStat[] {
  const t = today();
  return projects.map((project) => {
    const own = tasks.filter((x) => x.project_id === project.id);
    return {
      project,
      open: own.filter((x) => x.status === "active").length,
      overdue: own.filter((x) => x.status === "active" && !!x.due_date && x.due_date < t).length,
      done: own.filter(isDone).length,
    };
  });
}

// Шапка

export function greeting(d: Date): string {
  const h = d.getHours();
  return h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 17 ? "Добрый день" : h < 23 ? "Добрый вечер" : "Доброй ночи";
}

const WD_LONG = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const MON_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export const longDate = (d: Date) => `${WD_LONG[d.getDay()]}, ${d.getDate()} ${MON_GEN[d.getMonth()]}`;
export const weekdayShort = (day: string) => WD[parseDay(day).getDay()];
export const isWeekend = (day: string) => [0, 6].includes(parseDay(day).getDay());
