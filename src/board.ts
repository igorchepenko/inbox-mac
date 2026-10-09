import * as db from "./db";
import type { Task } from "./db";
import { addDays, nowStamp, today } from "./dates";
import { listFor, VIEWS, type ListItem, type ViewId } from "./views";

/** Как показан список: строками, канбаном или стопкой карточек. Хранится в settings под ключом layout:<вид> */
export type Layout = "list" | "board" | "cards";
export const layoutOf = (view: ViewId, settings: Record<string, string>): Layout => {
  const v = settings[`layout:${view}`];
  return v === "board" || v === "cards" ? v : "list";
};

/** Столбцы канбана: те же четыре списка, что в боковой панели */
export type Column = "inbox" | "today" | "soon" | "archive";
export const COLUMNS = VIEWS as { id: Column; name: string; accent: string; icon: string }[];

/** В проекте канбан показывает только его задачи, в остальных списках все */
function scoped(view: ViewId, tasks: Task[]): Task[] {
  if (!view.startsWith("p:")) return tasks;
  const pid = Number(view.slice(2));
  return tasks.filter((x) => x.project_id === pid);
}

export function boardFor(view: ViewId, tasks: Task[]): { col: Column; items: ListItem[] }[] {
  const mine = scoped(view, tasks);
  return COLUMNS.map((c) => ({ col: c.id, items: listFor(c.id, mine) }));
}

export function columnOf(x: Task): Column {
  const t = today();
  if (x.status === "inbox") return "inbox";
  if (x.status === "archived") return "archive";
  if (x.status === "done") return x.done_at?.slice(0, 10) === t ? "today" : "archive";
  return x.due_date && x.due_date <= t ? "today" : "soon";
}

/** Что станет с задачей при переносе в столбец: подпись над местом, куда её бросают */
export function dropHint(col: Column): string {
  if (col === "inbox") return "Вернётся на разбор";
  if (col === "today") return "Дата станет «Сегодня»";
  if (col === "soon") return "Прошедшая дата сдвинется на завтра";
  return "Отметится сделанной и уйдёт в архив";
}

function withDate(x: Task, d: string | null): Parameters<typeof db.updateTask>[1] {
  // Напоминание едет вместе с датой, время сохраняется
  const time = x.remind_at?.slice(11, 16);
  return time && d ? { due_date: d, remind_at: `${d}T${time}`, reminded: 0 } : { due_date: d };
}

/**
 * Перенос в столбец меняет данные задачи так, чтобы она оказалась именно там.
 * Сделанной отмечаем только через completeTask, вернуть через reopenTask: иначе сломаются повторы.
 */
export async function moveTo(x: Task, col: Column): Promise<void> {
  if (columnOf(x) === col) return;
  const t = today();
  if (col === "archive") {
    if (x.status === "inbox" || x.status === "active") await db.completeTask(x);
    await db.updateTask(x.id, { status: "archived" });
    return;
  }
  if (x.status === "done" || x.status === "archived") await db.reopenTask(x);
  if (col === "inbox") return db.updateTask(x.id, { status: "inbox", triaged_at: null });
  const triaged = { status: "active" as const, triaged_at: x.triaged_at ?? nowStamp() };
  if (col === "today") return db.updateTask(x.id, { ...triaged, ...withDate(x, t) });
  // «Скоро»: будущая дата и пустая остаются как есть, прошедшая и сегодняшняя переезжают на завтра
  const keep = !x.due_date || x.due_date > t;
  return db.updateTask(x.id, keep ? triaged : { ...triaged, ...withDate(x, addDays(t, 1)) });
}

// Массовые действия над выделенными задачами. Архивные не правим, их можно только вернуть или удалить

const live = (xs: Task[]) => xs.filter((x) => x.status !== "archived");

export async function bulkMove(xs: Task[], col: Column): Promise<void> {
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
