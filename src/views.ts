import type { Task } from "./db";
import { fmtDay, stampDay, stampTime, today } from "./dates";
import { quickKeyLabel } from "./prefs";
import { PRIORITY } from "./priority";

export type ViewId = "home" | "projects" | "inbox" | "today" | "soon" | "archive" | "calendar" | `p:${number}`;

export const VIEWS: { id: ViewId; name: string; accent: string; icon: string }[] = [
  { id: "inbox", name: "Новые", accent: "move", icon: "inbox" },
  { id: "today", name: "Сегодня", accent: "exercise", icon: "sun" },
  { id: "soon", name: "Скоро", accent: "stand", icon: "calendar" },
  { id: "archive", name: "Архив", accent: "muted", icon: "archive" },
  { id: "calendar", name: "Календарь", accent: "stand", icon: "schedule" },
];

export interface ListItem {
  task: Task;
  group?: string; // заголовок группы перед строкой
}

const doneToday = (x: Task, t: string) => x.status === "done" && !!x.done_at && stampDay(x.done_at) === t;

/** Порядок строк в списке и в столбцах канбана. Хранится отдельно для каждого списка: settings sort:<вид> */
export type SortBy = "date" | "priority" | "matrix";
export const SORTS: { id: SortBy; name: string; hint: string }[] = [
  { id: "date", name: "По дате", hint: "По дате и времени: ближайшие сверху" },
  { id: "priority", name: "По важности", hint: "По важности: самые важные сверху" },
  { id: "matrix", name: "По матрице", hint: "По матрице Эйзенхауэра: срочно и важно сверху" },
];
export const sortOf = (view: ViewId, settings: Record<string, string>): SortBy =>
  SORTS.find((s) => s.id === settings[`sort:${view}`])?.id ?? "date";

// Порядок квадрантов задал Игорь: срочно и важно, срочно не важно, важно не срочно, не срочно не важно
const QUAD_ORDER = [1, 3, 2, 4];
const QUAD_NAMES: Record<number, string> = { 1: "Срочно и важно", 2: "Важно, не срочно", 3: "Срочно, не важно", 4: "Не срочно, не важно" };
const quadRank = (x: Task) => (x.quadrant ? QUAD_ORDER.indexOf(x.quadrant) : 9);
// Время задачи в дне: начало из календаря, иначе напоминание. Без времени после задач со временем
const timeOf = (x: Task) => x.start_time ?? (x.remind_at ? stampTime(x.remind_at) : "99");

/** Ближайшие сверху: дата (без даты в конце), время, затем важнее и свежее */
function byDate(a: Task, b: Task): number {
  const ad = a.due_date ?? "9999", bd = b.due_date ?? "9999";
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = timeOf(a), bt = timeOf(b);
  if (at !== bt) return at < bt ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.created_at < b.created_at ? 1 : -1;
}

export function compareBy(sort: SortBy): (a: Task, b: Task) => number {
  if (sort === "priority") return (a, b) => b.priority - a.priority || byDate(a, b);
  if (sort === "matrix") return (a, b) => quadRank(a) - quadRank(b) || byDate(a, b);
  return byDate;
}

/** Заголовок группы при сортировке по важности или матрице: видно, где кончается один уровень и начинается другой */
function groupName(x: Task, sort: SortBy): string {
  if (x.status === "done") return "Сделано";
  if (sort === "priority") return PRIORITY.find((p) => p.value === x.priority)?.name ?? "Важность не задана";
  return x.quadrant ? QUAD_NAMES[x.quadrant] : "Вне матрицы";
}

/** Открытые выше сделанных, внутри по выбранной сортировке; при важности и матрице с заголовками групп */
function arrange(xs: Task[], sort: SortBy): ListItem[] {
  const cmp = compareBy(sort);
  const sorted = [...xs].sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0) || cmp(a, b));
  if (sort === "date") return sorted.map((task) => ({ task }));
  let last = "";
  return sorted.map((task) => {
    const g = groupName(task, sort);
    const item = g !== last ? { task, group: g } : { task };
    last = g;
    return item;
  });
}

export function listFor(view: ViewId, tasks: Task[], sort: SortBy = "date"): ListItem[] {
  const t = today();
  if (view === "home" || view === "projects") return [];
  if (view === "inbox") return arrange(tasks.filter((x) => x.status === "inbox"), sort);
  if (view === "today") return arrange(tasks.filter((x) => (x.status === "active" && !!x.due_date && x.due_date <= t) || doneToday(x, t)), sort);
  if (view === "archive")
    return tasks
      .filter((x) => x.status === "archived")
      .sort((a, b) => ((a.done_at ?? "") < (b.done_at ?? "") ? 1 : -1))
      .map((task) => ({ task }));
  if (view === "soon") {
    const active = tasks.filter((x) => x.status === "active" && (!x.due_date || x.due_date > t));
    if (sort !== "date") return arrange(active, sort);
    // По дате: будущие даты по дням, затем всё разобранное без даты, чтобы ничего не терялось
    const out: ListItem[] = [];
    let last = "";
    for (const task of active.sort(byDate)) {
      const g = task.due_date ? fmtDay(task.due_date) : "Без даты";
      out.push(g !== last ? { task, group: g } : { task });
      last = g;
    }
    return out;
  }
  if (view === "calendar") return []; // у календаря своя сетка, см. CalendarView
  const pid = Number(view.slice(2));
  return arrange(tasks.filter((x) => x.project_id === pid && (x.status === "active" || doneToday(x, t))), sort);
}

export function countFor(view: ViewId, tasks: Task[]): number {
  if (view === "archive" || view === "calendar" || view === "projects") return 0;
  return listFor(view, tasks).filter((i) => i.task.status !== "done").length;
}

export interface Progress {
  fraction: number;
  count: number; // сколько осталось: неразобранных или несделанных
  accent: string;
  subtitle: string;
}

export function progressFor(view: ViewId, tasks: Task[]): Progress | null {
  const t = today();
  if (view === "inbox") {
    const left = tasks.filter((x) => x.status === "inbox").length;
    const sorted = tasks.filter((x) => !!x.triaged_at && stampDay(x.triaged_at) === t).length;
    const subtitle = left
      ? `${plural(left, "задача ждёт", "задачи ждут", "задач ждут")} разбора${sorted ? `, разобрано сегодня ${sorted}` : ""}`
      : sorted ? `Всё разобрано, сегодня ${sorted}` : `Пусто. Нажми ${quickKeyLabel()}, чтобы записать задачу`;
    return { fraction: left + sorted ? sorted / (left + sorted) : 0, count: left, accent: "move", subtitle };
  }
  if (view === "today") {
    const items = listFor("today", tasks);
    const done = items.filter((i) => i.task.status === "done").length;
    return {
      fraction: items.length ? done / items.length : 0,
      count: items.length - done,
      accent: "exercise",
      subtitle: items.length ? `${done} из ${items.length} сделано` : "На сегодня ничего не запланировано",
    };
  }
  return null;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
}
