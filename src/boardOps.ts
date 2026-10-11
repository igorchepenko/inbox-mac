import * as db from "./db";
import type { Task } from "./db";
import { addDays, nowStamp, stampDay, stampTime, today } from "./dates";
import { compareBy, VIEWS, type ListItem, type SortBy, type ViewId } from "./views";

/** Как показан список: строками или канбаном. Хранится в settings под ключом layout:<вид> */
export type Layout = "list" | "board";
export const layoutOf = (view: ViewId, settings: Record<string, string>): Layout =>
  settings[`layout:${view}`] === "board" ? "board" : "list";

/** Куда можно разом перенести выделенные задачи: те же списки, что в боковой панели */
export type Target = "inbox" | "today" | "soon" | "archive";
const TARGET_IDS: string[] = ["inbox", "today", "soon", "archive"];
export const TARGETS = VIEWS.filter((v) => TARGET_IDS.includes(v.id)) as { id: Target; name: string; accent: string; icon: string }[];

/** Канбан строится только по этапу работы: Новые, К выполнению, Готово */
export interface BoardColumn {
  key: Stage;
  name: string;
  accent: string;
  icon: string;
  hint: string; // что станет с задачей при переносе сюда
  items: ListItem[];
}

/** «Готово» на канбане показывает сделанное за неделю, старое живёт в архиве */
const DONE_DAYS = 7;

/** В проекте и теге канбан показывает только их задачи, в остальных списках все */
function scoped(view: ViewId, tasks: Task[]): Task[] {
  const id = Number(view.slice(2));
  if (view.startsWith("p:")) return tasks.filter((x) => x.project_id === id);
  if (view.startsWith("t:")) return tasks.filter((x) => x.tags.some((g) => g.id === id));
  return tasks;
}

const isOpen = (x: Task) => x.status === "inbox" || x.status === "active";

export type Stage = "new" | "todo" | "done";
export const STAGES: Omit<BoardColumn, "items">[] = [
  { key: "new", name: "Новые", accent: "move", icon: "inbox", hint: "Вернётся в «Новые»" },
  { key: "todo", name: "К выполнению", accent: "stand", icon: "flag", hint: "Разобрана, ждёт очереди" },
  { key: "done", name: "Готово", accent: "exercise", icon: "target", hint: "Отметится сделанной" },
];

/** Этап задачи: тот же, что столбец канбана. Отметка «в работе» из прошлой версии больше не учитывается */
export function stageOf(x: Task): Stage {
  if (x.status === "inbox") return "new";
  if (x.status === "done" || x.status === "archived") return "done";
  return "todo";
}

export function boardFor(view: ViewId, tasks: Task[], sort: SortBy): BoardColumn[] {
  const since = addDays(today(), -DONE_DAYS);
  // Канбан про текущую работу: сделанное видно только за последнюю неделю
  const mine = scoped(view, tasks).filter((x) => isOpen(x) || (!!x.done_at && stampDay(x.done_at) > since));
  const cmp = compareBy(sort);
  return STAGES.map((c) => {
    const xs = mine.filter((x) => stageOf(x) === c.key);
    xs.sort(c.key === "done" ? (a, b) => ((a.done_at ?? "") < (b.done_at ?? "") ? 1 : -1) : cmp);
    return { ...c, items: xs.map((task) => ({ task })) };
  });
}

/**
 * Перенос карточки в столбец. Сделанной отмечаем только через completeTask, вернуть через reopenTask:
 * иначе сломаются повторы.
 */
export async function dropTo(x: Task, key: Stage): Promise<void> {
  if (stageOf(x) === key) return;
  if (key === "done") return db.completeTask(x);
  if (x.status === "done" || x.status === "archived") await db.reopenTask(x);
  if (key === "new") return db.updateTask(x.id, { status: "inbox", triaged_at: null, started_at: null });
  return db.updateTask(x.id, { status: "active", triaged_at: x.triaged_at ?? nowStamp(), started_at: null });
}

function withDate(x: Task, d: string | null): Parameters<typeof db.updateTask>[1] {
  // Напоминание едет вместе с датой, время сохраняется
  const time = x.remind_at && stampTime(x.remind_at);
  return time && d ? { due_date: d, remind_at: `${d}T${time}`, reminded: 0 } : { due_date: d };
}

function targetOf(x: Task): Target {
  const t = today();
  if (x.status === "inbox") return "inbox";
  if (x.status === "archived") return "archive";
  if (x.status === "done") return !!x.done_at && stampDay(x.done_at) === t ? "today" : "archive";
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
