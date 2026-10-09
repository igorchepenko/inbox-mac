import * as db from "./db";
import type { Task } from "./db";
import { addDays, fmtDay, nextMonday, nowStamp, today } from "./dates";
import { PRIORITY } from "./components";
import { QUADRANTS } from "./extras";
import { VIEWS, type ListItem, type ViewId } from "./views";

/** Как показан список: строками или канбаном. Хранится в settings под ключом layout:<вид> */
export type Layout = "list" | "board";
export const layoutOf = (view: ViewId, settings: Record<string, string>): Layout =>
  settings[`layout:${view}`] === "board" ? "board" : "list";

/** Куда можно разом перенести выделенные задачи: те же списки, что в боковой панели */
export type Target = "inbox" | "today" | "soon" | "archive";
const TARGET_IDS: string[] = ["inbox", "today", "soon", "archive"];
export const TARGETS = VIEWS.filter((v) => TARGET_IDS.includes(v.id)) as { id: Target; name: string; accent: string; icon: string }[];

/**
 * Канбан. Столбцы задаёт группировка: этап работы (по умолчанию), срок, важность или матрица.
 * Перенос карточки в столбец меняет ровно то поле, по которому сгруппировано.
 */
export type Group = "stage" | "due" | "priority" | "quadrant";
export const GROUPS: { id: Group; name: string }[] = [
  { id: "stage", name: "Этап" },
  { id: "due", name: "Срок" },
  { id: "priority", name: "Важность" },
  { id: "quadrant", name: "Матрица" },
];
export const groupOf = (settings: Record<string, string>): Group =>
  (GROUPS.find((g) => g.id === settings["board.group"])?.id ?? "stage");

export interface BoardColumn {
  key: string;
  name: string;
  accent: string;
  icon?: string;
  prio?: number; // столбец важности: в шапке её иконка
  hint: string | null; // что станет с задачей при переносе сюда; null — сюда переносить нельзя
  items: ListItem[];
}

/** «Готово» на канбане показывает сделанное за неделю, старое живёт в архиве */
const DONE_DAYS = 7;

/** В проекте канбан показывает только его задачи, в остальных списках все */
function scoped(view: ViewId, tasks: Task[]): Task[] {
  if (!view.startsWith("p:")) return tasks;
  const pid = Number(view.slice(2));
  return tasks.filter((x) => x.project_id === pid);
}

const isOpen = (x: Task) => x.status === "inbox" || x.status === "active";

// Внутри столбца: ближайший срок выше, без срока ниже, затем важнее и свежее
function byDue(a: Task, b: Task): number {
  const ad = a.due_date ?? "9999", bd = b.due_date ?? "9999";
  if (ad !== bd) return ad < bd ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.created_at < b.created_at ? 1 : -1;
}

/** Ближайшая дата для столбца «Позже»: следующий понедельник, но не раньше послезавтра */
export function laterDate(): string {
  const t = today();
  const m = nextMonday();
  return m > addDays(t, 1) ? m : addDays(m, 7);
}

/** Этап задачи на канбане */
export function stageOf(x: Task): "new" | "todo" | "doing" | "done" {
  if (x.status === "inbox") return "new";
  if (x.status === "done" || x.status === "archived") return "done";
  return x.started_at ? "doing" : "todo";
}

export function dueOf(x: Task): "overdue" | "today" | "tomorrow" | "later" | "none" {
  const t = today();
  if (!x.due_date) return "none";
  if (x.due_date < t) return "overdue";
  if (x.due_date === t) return "today";
  return x.due_date === addDays(t, 1) ? "tomorrow" : "later";
}

type Spec = Omit<BoardColumn, "items"> & { has: (x: Task) => boolean };

function specs(group: Group): Spec[] {
  if (group === "stage")
    return [
      { key: "new", name: "Новые", accent: "move", icon: "inbox", hint: "Вернётся на разбор", has: (x) => stageOf(x) === "new" },
      { key: "todo", name: "К выполнению", accent: "stand", icon: "flag", hint: "Разобрана, ждёт очереди", has: (x) => stageOf(x) === "todo" },
      { key: "doing", name: "В работе", accent: "amber", icon: "zap", hint: "Возьмётся в работу", has: (x) => stageOf(x) === "doing" },
      { key: "done", name: "Готово", accent: "exercise", icon: "target", hint: "Отметится сделанной", has: (x) => stageOf(x) === "done" },
    ];
  if (group === "due") {
    const later = laterDate();
    return [
      { key: "overdue", name: "Просрочено", accent: "move", icon: "bell", hint: null, has: (x) => dueOf(x) === "overdue" },
      { key: "today", name: "Сегодня", accent: "exercise", icon: "sun", hint: "Дата станет «Сегодня»", has: (x) => dueOf(x) === "today" },
      { key: "tomorrow", name: "Завтра", accent: "stand", icon: "calendar", hint: "Дата станет «Завтра»", has: (x) => dueOf(x) === "tomorrow" },
      { key: "later", name: "Позже", accent: "stand", icon: "schedule", hint: `Ближайшая дата станет «${fmtDay(later)}»`, has: (x) => dueOf(x) === "later" },
      { key: "none", name: "Без срока", accent: "muted", icon: "folder", hint: "Дата уберётся", has: (x) => dueOf(x) === "none" },
    ];
  }
  if (group === "priority")
    // Уровни берутся из PRIORITY: станет их больше — станет больше столбцов. Важные слева
    return [
      ...[...PRIORITY].reverse().map((p) => ({
        key: String(p.value), name: p.name, accent: p.accent, prio: p.value, hint: `Важность станет «${p.name.toLowerCase()}»`,
        has: (x: Task) => x.priority === p.value,
      })),
      { key: "0", name: "Не задана", accent: "muted", hint: "Важность снимется", has: (x) => !PRIORITY.some((p) => p.value === x.priority) },
    ];
  return [
    ...QUADRANTS.map((q) => ({
      key: String(q.value), name: q.name, accent: q.accent, hint: `Квадрант: ${q.hint}`, has: (x: Task) => x.quadrant === q.value,
    })),
    { key: "0", name: "Вне матрицы", accent: "muted", hint: "Квадрант снимется", has: (x) => !x.quadrant },
  ];
}

export function boardFor(view: ViewId, tasks: Task[], group: Group): BoardColumn[] {
  const t = today();
  const since = addDays(t, -DONE_DAYS);
  // Канбан про текущую работу: сделанное видно только в «Готово» по этапам, и только за последнюю неделю
  const mine = scoped(view, tasks).filter((x) =>
    group === "stage" ? isOpen(x) || (!!x.done_at && x.done_at.slice(0, 10) > since) : isOpen(x));
  return specs(group).map(({ has, ...c }) => {
    const xs = mine.filter(has);
    xs.sort(c.key === "done" && group === "stage" ? (a, b) => ((a.done_at ?? "") < (b.done_at ?? "") ? 1 : -1) : byDue);
    return { ...c, items: xs.map((task) => ({ task })) };
  });
}

/**
 * Перенос карточки в столбец. Сделанной отмечаем только через completeTask, вернуть через reopenTask:
 * иначе сломаются повторы.
 */
export async function dropTo(x: Task, group: Group, key: string): Promise<void> {
  if (group === "stage") {
    if (stageOf(x) === key) return;
    if (key === "done") return db.completeTask(x);
    if (x.status === "done" || x.status === "archived") await db.reopenTask(x);
    if (key === "new") return db.updateTask(x.id, { status: "inbox", triaged_at: null, started_at: null });
    const triaged = { status: "active" as const, triaged_at: x.triaged_at ?? nowStamp() };
    return db.updateTask(x.id, { ...triaged, started_at: key === "doing" ? x.started_at ?? nowStamp() : null });
  }
  if (x.status === "archived") return;
  if (group === "due") {
    if (dueOf(x) === key || key === "overdue") return;
    const t = today();
    const d = key === "today" ? t : key === "tomorrow" ? addDays(t, 1) : key === "later" ? laterDate() : null;
    return db.updateTask(x.id, withDate(x, d));
  }
  if (group === "priority") return db.updateTask(x.id, { priority: Number(key) });
  return db.updateTask(x.id, { quadrant: Number(key) || null });
}

function withDate(x: Task, d: string | null): Parameters<typeof db.updateTask>[1] {
  // Напоминание едет вместе с датой, время сохраняется
  const time = x.remind_at?.slice(11, 16);
  return time && d ? { due_date: d, remind_at: `${d}T${time}`, reminded: 0 } : { due_date: d };
}

function targetOf(x: Task): Target {
  const t = today();
  if (x.status === "inbox") return "inbox";
  if (x.status === "archived") return "archive";
  if (x.status === "done") return x.done_at?.slice(0, 10) === t ? "today" : "archive";
  return x.due_date && x.due_date <= t ? "today" : "soon";
}

/**
 * Перенос в список меняет данные задачи так, чтобы она оказалась именно там.
 * Сделанной отмечаем только через completeTask, вернуть через reopenTask: иначе сломаются повторы.
 */
export async function moveTo(x: Task, col: Target): Promise<void> {
  if (targetOf(x) === col) return;
  const t = today();
  if (col === "archive") {
    if (x.status === "inbox" || x.status === "active") await db.completeTask(x);
    await db.updateTask(x.id, { status: "archived" });
    return;
  }
  if (x.status === "done" || x.status === "archived") await db.reopenTask(x);
  if (col === "inbox") return db.updateTask(x.id, { status: "inbox", triaged_at: null, started_at: null });
  const triaged = { status: "active" as const, triaged_at: x.triaged_at ?? nowStamp() };
  if (col === "today") return db.updateTask(x.id, { ...triaged, ...withDate(x, t) });
  // «Скоро»: будущая дата и пустая остаются как есть, прошедшая и сегодняшняя переезжают на завтра
  const keep = !x.due_date || x.due_date > t;
  return db.updateTask(x.id, keep ? triaged : { ...triaged, ...withDate(x, addDays(t, 1)) });
}

// Массовые действия над выделенными задачами. Архивные не правим, их можно только вернуть или удалить

const live = (xs: Task[]) => xs.filter((x) => x.status !== "archived");

export async function bulkMove(xs: Task[], col: Target): Promise<void> {
  for (const x of xs) await moveTo(x, col);
}

export async function bulkTriage(xs: Task[]): Promise<void> {
  for (const x of xs.filter((x) => x.status === "inbox")) await db.updateTask(x.id, { status: "active", triaged_at: nowStamp() });
}

export async function bulkDate(xs: Task[], d: string | null): Promise<void> {
  for (const x of live(xs)) await db.updateTask(x.id, withDate(x, d));
}

export async function bulkProject(xs: Task[], projectId: number | null): Promise<void> {
  for (const x of live(xs)) await db.updateTask(x.id, { project_id: projectId });
}

export async function bulkPriority(xs: Task[], priority: number): Promise<void> {
  for (const x of live(xs)) await db.updateTask(x.id, { priority });
}

export async function bulkDone(xs: Task[]): Promise<void> {
  for (const x of xs.filter((x) => x.status === "inbox" || x.status === "active")) await db.completeTask(x);
}

export async function bulkReopen(xs: Task[]): Promise<void> {
  for (const x of xs.filter((x) => x.status === "done" || x.status === "archived")) await db.reopenTask(x);
}

export async function bulkDelete(xs: Task[]): Promise<void> {
  for (const x of xs) await db.deleteTask(x.id);
}
