import { isCancelled, type Task } from "./db";
import { fmtDay, stampDay, stampTime, today } from "./dates";
import { quickKeyLabel } from "./prefs";
import { PRIORITY } from "./priority";
import { compareNames, firstTag } from "./tags";

export type ViewId = "home" | "projects" | "inbox" | "today" | "soon" | "archive" | "calendar" | `p:${number}` | `t:${number}`;

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
export type SortBy = "date" | "created" | "priority" | "matrix" | "tag" | "assignee";
export const SORTS: { id: SortBy; name: string; hint: string }[] = [
  { id: "date", name: "По дате", hint: "По дате и времени: ближайшие сверху" },
  { id: "created", name: "По дате создания", hint: "По дате создания: новые сверху" },
  { id: "priority", name: "По важности", hint: "По важности: самые важные сверху" },
  { id: "matrix", name: "По матрице", hint: "По матрице Эйзенхауэра: срочно и важно сверху" },
  { id: "tag", name: "По тегам", hint: "По тегам: группы по алфавиту, без тегов в конце" },
  { id: "assignee", name: "По тому, кто назначил", hint: "По тому, кто назначил: группы по именам, свои задачи в конце" },
];
export const sortOf = (view: ViewId, settings: Record<string, string>): SortBy =>
  SORTS.find((s) => s.id === settings[`sort:${view}`])?.id ?? "date";

/** Обратный порядок хранится для каждого списка и каждой сортировки отдельно: settings sort.rev:<вид>:<сортировка> = "1".
 * Без него порядок обычный, как в подсказке SORTS */
export const revKey = (view: ViewId, sort: SortBy) => `sort.rev:${view}:${sort}`;
export const revOf = (view: ViewId, sort: SortBy, settings: Record<string, string>): boolean => settings[revKey(view, sort)] === "1";

/** Подписи направлений: [обычный, обратный]. asc — обычный порядок идёт по возрастанию значения */
export const DIRECTIONS: Record<SortBy, { asc: boolean; names: [string, string] }> = {
  date: { asc: true, names: ["ближайшие сверху", "дальние сверху"] },
  created: { asc: false, names: ["новые сверху", "старые сверху"] },
  priority: { asc: false, names: ["самые важные сверху", "менее важные сверху"] },
  matrix: { asc: true, names: ["срочно и важно сверху", "не срочно и не важно сверху"] },
  tag: { asc: true, names: ["теги от А до Я", "теги от Я до А"] },
  assignee: { asc: true, names: ["имена от А до Я", "имена от Я до А"] },
};
/** По возрастанию или по убыванию идёт список сейчас, и словами, что сверху */
export function directionOf(sort: SortBy, rev: boolean): { asc: boolean; text: string } {
  const d = DIRECTIONS[sort];
  return { asc: d.asc !== rev, text: d.names[rev ? 1 : 0] };
}

// Порядок квадрантов задал Игорь: срочно и важно, срочно не важно, важно не срочно, не срочно не важно
const QUAD_ORDER = [1, 3, 2, 4];
const QUAD_NAMES: Record<number, string> = { 1: "Срочно и важно", 2: "Важно, не срочно", 3: "Срочно, не важно", 4: "Не срочно, не важно" };
const quadRank = (x: Task) => (x.quadrant ? QUAD_ORDER.indexOf(x.quadrant) : 9);
// Время задачи в дне: начало из календаря, иначе срок «до 18:00», иначе напоминание. Без времени после задач со временем
const timeOf = (x: Task) => x.start_time ?? x.end_time ?? (x.remind_at ? stampTime(x.remind_at) : "99");

// Сравнение, где пустое значение всегда в конце, а непустые можно развернуть
function lastEmpty<T>(a: T | null, b: T | null, cmp: (a: T, b: T) => number, rev: boolean): number {
  if (a == null || b == null) return (a == null ? 1 : 0) - (b == null ? 1 : 0);
  return rev ? cmp(b, a) : cmp(a, b);
}
const str = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Ближайшие сверху: дата (без даты в конце), время, затем важнее и свежее. rev: дальние сверху, без даты всё так же в конце */
function byDate(a: Task, b: Task, rev = false): number {
  const d = lastEmpty(a.due_date, b.due_date, str, rev);
  if (d) return d;
  const at = timeOf(a), bt = timeOf(b);
  if (at !== bt) return (at < bt ? -1 : 1) * (rev ? -1 : 1);
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.created_at < b.created_at ? 1 : -1;
}

/** rev разворачивает главный ключ сортировки. Задачи без значения (без даты, тега, важности, вне матрицы, свои) остаются в конце,
 * а внутри одной группы порядок всегда по дате, ближайшие сверху */
export function compareBy(sort: SortBy, rev = false): (a: Task, b: Task) => number {
  if (sort === "created") return (a, b) => str(b.created_at, a.created_at) * (rev ? -1 : 1);
  if (sort === "priority") return (a, b) => lastEmpty(a.priority || null, b.priority || null, (x, y) => y - x, rev) || byDate(a, b);
  if (sort === "matrix") return (a, b) => lastEmpty(a.quadrant && quadRank(a), b.quadrant && quadRank(b), (x, y) => x - y, rev) || byDate(a, b);
  if (sort === "tag") return (a, b) => lastEmpty(firstTag(a), firstTag(b), compareNames, rev) || byDate(a, b);
  if (sort === "assignee") return (a, b) => lastEmpty(a.assigned_by, b.assigned_by, compareNames, rev) || byDate(a, b);
  return (a, b) => byDate(a, b, rev);
}

export const NO_TAG_GROUP = "Без тегов";
export const NO_PERSON_GROUP = "Сам себе";

/** Заголовок группы при сортировке не по дате: видно, где кончается один уровень и начинается другой.
 * Задача с несколькими тегами стоит в группе первого по алфавиту */
function groupName(x: Task, sort: SortBy): string {
  if (x.status === "done") return x.cancelled ? "Отменено" : "Сделано";
  if (sort === "created") return `Создано ${fmtDay(stampDay(x.created_at)).toLowerCase()}`;
  if (sort === "tag") return firstTag(x) ?? NO_TAG_GROUP;
  if (sort === "assignee") return x.assigned_by ?? NO_PERSON_GROUP;
  if (sort === "priority") return PRIORITY.find((p) => p.value === x.priority)?.name ?? "Важность не задана";
  return x.quadrant ? QUAD_NAMES[x.quadrant] : "Вне матрицы";
}

/** Открытые выше сделанных и отменённых, внутри по выбранной сортировке; при важности и матрице с заголовками групп */
function arrange(xs: Task[], sort: SortBy, rev: boolean): ListItem[] {
  const cmp = compareBy(sort, rev);
  // Открытые, затем сделанные, в самом низу отменённые
  const rank = (x: Task) => (x.status === "done" ? (x.cancelled ? 2 : 1) : 0);
  const sorted = [...xs].sort((a, b) => rank(a) - rank(b) || cmp(a, b));
  if (sort === "date") return sorted.map((task) => ({ task }));
  let last = "";
  return sorted.map((task) => {
    const g = groupName(task, sort);
    const item = g !== last ? { task, group: g } : { task };
    last = g;
    return item;
  });
}

export function listFor(view: ViewId, tasks: Task[], sort: SortBy = "date", rev = false): ListItem[] {
  const t = today();
  if (view === "home" || view === "projects") return [];
  if (view === "inbox") return arrange(tasks.filter((x) => x.status === "inbox"), sort, rev);
  if (view === "today") return arrange(tasks.filter((x) => (x.status === "active" && !!x.due_date && x.due_date <= t) || doneToday(x, t)), sort, rev);
  if (view === "archive")
    return tasks
      .filter((x) => x.status === "archived")
      .sort((a, b) => ((a.done_at ?? "") < (b.done_at ?? "") ? 1 : -1))
      .map((task) => ({ task }));
  if (view === "soon") {
    const active = tasks.filter((x) => x.status === "active" && (!x.due_date || x.due_date > t));
    if (sort !== "date") return arrange(active, sort, rev);
    // По дате: будущие даты по дням, затем всё разобранное без даты, чтобы ничего не терялось
    const out: ListItem[] = [];
    let last = "";
    for (const task of active.sort(compareBy("date", rev))) {
      const g = task.due_date ? fmtDay(task.due_date) : "Без даты";
      out.push(g !== last ? { task, group: g } : { task });
      last = g;
    }
    return out;
  }
  if (view === "calendar") return []; // у календаря своя сетка, см. CalendarView
  if (view.startsWith("t:")) {
    // Тег: все его задачи в работе, включая неразобранные, и сделанные сегодня
    const tid = Number(view.slice(2));
    return arrange(tasks.filter((x) => x.tags.some((g) => g.id === tid) && (x.status === "inbox" || x.status === "active" || doneToday(x, t))), sort, rev);
  }
  const pid = Number(view.slice(2));
  return arrange(tasks.filter((x) => x.project_id === pid && (x.status === "active" || doneToday(x, t))), sort, rev);
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
    // Отменённые не в счёт: ни в план, ни в сделанное
    const all = listFor("today", tasks);
    const cancelled = all.filter((i) => isCancelled(i.task)).length;
    const items = all.filter((i) => !isCancelled(i.task));
    const done = items.filter((i) => i.task.status === "done").length;
    const tail = cancelled ? `, отменено ${cancelled}` : "";
    return {
      fraction: items.length ? done / items.length : 0,
      count: items.length - done,
      accent: "exercise",
      subtitle: items.length ? `${done} из ${items.length} сделано${tail}` : cancelled ? `Всё отменено: ${cancelled}` : "На сегодня ничего не запланировано",
    };
  }
  return null;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
}
