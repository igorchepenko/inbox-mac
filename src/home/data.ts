// Расчёты для главной: всё считается из задач на лету, отдельных таблиц для статистики нет
import type { Project, Task } from "../db";
import { addDays, daysBetween, fmtMin, hoursBetween, monthEnd, monthStart, stampDay, toMin, today, weekdayShort, weekStart } from "../dates";

export const BLOCKS = [
  { id: "summary", name: "Итоги дня", hint: "", span: 12 },
  { id: "today", name: "Сегодня", hint: "полоса дня и список", span: 8 },
  { id: "inbox", name: "Новые", hint: "", span: 4 },
  { id: "week", name: "Ближайшие 7 дней", hint: "", span: 7 },
  { id: "matrix", name: "Матрица Эйзенхауэра", hint: "необязательно", span: 5 },
  { id: "stats", name: "Статистика", hint: "", span: 8 },
  { id: "projects", name: "Пространства", hint: "", span: 4 },
  { id: "meetings", name: "Встречи", hint: "статистика", span: 12 },
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


/** Задача без конца занимает полчаса */
export function duration(x: Task): number {
  if (!x.start_time) return 0;
  const d = x.end_time ? toMin(x.end_time) - toMin(x.start_time) : 30;
  return d > 0 ? d : 30;
}


export const timeRange = (x: Task) => (x.start_time ? `${x.start_time}–${fmtMin(toMin(x.start_time) + duration(x))}` : "");

// Состояния задач

export const isDone = (x: Task) => x.status === "done" || x.status === "archived";
const doneDay = (x: Task) => (isDone(x) && x.done_at ? stampDay(x.done_at) : null);
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
    triagedToday: tasks.filter((x) => !!x.triaged_at && stampDay(x.triaged_at) === t).length,
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
  const first = stampDay(tasks.reduce((m, x) => (x.created_at < m ? x.created_at : m), t));
  const left = tasks.map((x) => ({
    from: stampDay(x.created_at),
    // Когда задача ушла из входящих; у ещё лежащих там — никогда
    out: x.status === "inbox" ? "9999" : stampDay(x.triaged_at ?? x.done_at ?? x.created_at),
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
    .map((task) => ({ task, age: Math.max(0, daysBetween(stampDay(task.created_at), t)) }));
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
  { q: 4, name: "Отложить", color: "q4" },
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


export function stats(tasks: Task[], period: Period, cfg: DayConfig): Stats {
  const t = today();
  const n = period === "week" ? 7 : 4;
  const len = period === "week" ? 1 : 7;
  const from = addDays(t, -(n * len - 1));
  const bars: Bar[] = Array.from({ length: n }, (_, i) => {
    const start = addDays(from, i * len);
    const label = period === "week"
      ? i === n - 1 ? "Сег" : weekdayShort(start)
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
  const triaged = tasks.filter((x) => !!x.triaged_at && stampDay(x.triaged_at) >= from);
  // Запланированное: вся текущая неделя с понедельника или весь месяц
  const pFrom = period === "week" ? weekStart(t) : monthStart(t);
  const pTo = period === "week" ? addDays(pFrom, 6) : monthEnd(t);
  const planned = busyMinutes(tasks.filter((x) => x.status !== "inbox" && !!x.due_date && x.due_date >= pFrom && x.due_date <= pTo));
  return {
    bars,
    goal: period === "week" ? cfg.goal : cfg.goal * 5,
    done: done.length,
    onTime: withDue.length ? withDue.filter((x) => doneDay(x)! <= x.due_date!).length / withDue.length : null,
    triage: triaged.length ? triaged.reduce((s, x) => s + hoursBetween(x.created_at, x.triaged_at!), 0) / triaged.length : null,
    planned,
  };
}

export function fmtHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} мин`;
  if (h < 24) return `${Math.round(h)} ч`;
  return `${(h / 24).toFixed(1).replace(".", ",")} дн.`;
}

// Встречи

export interface MeetingPerson {
  name: string;
  count: number;
  minutes: number;
}

export interface MeetingStats {
  count: number;
  done: number; // уже прошедшие (отмеченные сделанными)
  minutes: number; // только встречи со временем начала
  untimed: number; // встречи без времени: в часы не входят
  people: MeetingPerson[]; // по убыванию числа встреч
}

/** Встречи (kind='meeting') с датой в текущей неделе (с понедельника) или месяце. Работает по assigned_by */
export function meetingStats(tasks: Task[], period: Period): MeetingStats {
  const t = today();
  const from = period === "week" ? weekStart(t) : monthStart(t);
  const to = period === "week" ? addDays(from, 6) : monthEnd(t);
  const list = tasks.filter((x) => x.kind === "meeting" && x.status !== "inbox" && !!x.due_date && x.due_date >= from && x.due_date <= to);
  const byName = new Map<string, MeetingPerson>();
  for (const x of list) {
    const name = x.assigned_by?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const p = byName.get(key) ?? { name, count: 0, minutes: 0 };
    p.count++;
    p.minutes += duration(x);
    byName.set(key, p);
  }
  return {
    count: list.length,
    done: list.filter(isDone).length,
    minutes: list.reduce((s, x) => s + duration(x), 0),
    untimed: list.filter((x) => !x.start_time).length,
    people: [...byName.values()].sort((a, b) => b.count - a.count || b.minutes - a.minutes || a.name.localeCompare(b.name, "ru")),
  };
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

