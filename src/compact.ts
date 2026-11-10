import type { Task } from "./db";
import { fmtDay, today } from "./dates";
import { listFor, revOf, sortOf, VIEWS, type ListItem, type ViewId } from "./views";

/*
 * Компактный вид (окно у значка на краю экрана): какие списки, в каком порядке и что писать в строке задачи.
 * Чистая логика под тесты, окно — в Compact.tsx
 */

/** Списки в переключателе компактного вида, по порядку */
export const COMPACT_LISTS: ViewId[] = ["tasks", "inbox", "today", "overdue", "soon", "waiting"];

export const listName = (v: ViewId) => VIEWS.find((x) => x.id === v)?.name ?? "";
export const listAccent = (v: ViewId) => VIEWS.find((x) => x.id === v)?.accent ?? "stand";
/** Иконка списка: своя, если её поменяли в меню главного окна (settings icon:<вид>) */
export const listIcon = (v: ViewId, settings: Record<string, string>) => settings[`icon:${v}`] ?? VIEWS.find((x) => x.id === v)?.icon ?? "tasks";

const STORE = "inbox.compact.view";
export function savedList(): ViewId {
  try {
    const v = localStorage.getItem(STORE) as ViewId | null;
    return v && COMPACT_LISTS.includes(v) ? v : "tasks";
  } catch {
    return "tasks";
  }
}
export function saveList(v: ViewId) {
  try {
    localStorage.setItem(STORE, v);
  } catch {
    /* без памяти о выборе тоже работает */
  }
}

/**
 * Строки списка в том же порядке, что в главном окне (сортировка списка из настроек).
 * Заголовки групп по дням не нужны: дата и так в каждой строке. Остаются только люди в «Жду»
 */
export function compactItems(view: ViewId, tasks: Task[], settings: Record<string, string> = {}): ListItem[] {
  const sort = sortOf(view, settings);
  const items = listFor(view, tasks, sort, revOf(view, sort, settings));
  return view === "waiting" ? items : items.map(({ task }) => ({ task }));
}

/** Дата в строке: «Сегодня», «Завтра», «Пт, 14 ноя», со временем, если оно есть. Без даты — null */
export function dueLabel(x: Pick<Task, "due_date" | "start_time" | "end_time">): string | null {
  if (!x.due_date) return null;
  const day = fmtDay(x.due_date);
  if (x.start_time) return `${day}, ${x.start_time}`;
  if (x.end_time) return `${day}, до ${x.end_time}`;
  return day;
}

/** Цвет даты: красный — день прошёл, янтарный — сегодня */
export function dueTone(x: Pick<Task, "due_date">, t = today()): "overdue" | "today" | null {
  if (!x.due_date) return null;
  if (x.due_date < t) return "overdue";
  return x.due_date === t ? "today" : null;
}
