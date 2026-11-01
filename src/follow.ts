import type { Task } from "./db";
import { stampDay, today } from "./dates";
import { boardFor } from "./boardOps";
import { applyFilter, NO_PERSON, NO_SPACE, type TaskFilter } from "./tags";
import { listFor, type ViewId } from "./views";
import { isWaiting } from "./waiting";

/*
 * Задача остаётся выбранной после правки в панели: если правка увела её из текущего списка,
 * центральная часть переходит туда, где задача теперь лежит, а фильтры подстраиваются. Чистая логика под тесты.
 * Таблица правил: inbox-app/selection-follow/follow-rules.md
 */

/** Где открыт центр: вид, подборка умных списков и фильтр */
export interface Where {
  view: ViewId;
  multi: ViewId[];
  filter: TaskFilter;
  board: boolean;
}

const NO_FOLLOW: ViewId[] = ["home", "projects", "tags", "people", "calendar"];

/** Видна ли задача в этом месте. Поиск по тексту не учитываем: его держит закрепление выбранной строки */
function visible(w: Where, tasks: Task[], id: number): boolean {
  const inSpace = w.view.startsWith("p:");
  const f = { ...w.filter, text: "", spaces: inSpace ? [] : w.filter.spaces };
  const shown = applyFilter(tasks, f);
  const base = w.view === "tasks" && w.multi.length >= 2
    ? shown.filter((x) => new Set(w.multi.flatMap((v) => listFor(v, shown).map((i) => i.task.id))).has(x.id))
    : shown;
  const items = w.board ? boardFor(w.view, base, "date").flatMap((c) => c.items) : listFor(w.view, base);
  return items.some((i) => i.task.id === id);
}

/** Фильтр подстраивается под задачу, чтобы он её не прятал: пространство добавляется, тег добавляется или снимается, человек меняется */
function adapt(f: TaskFilter, x: Task, view: ViewId): TaskFilter {
  const out = { ...f };
  if (!view.startsWith("p:") && out.spaces.length && !out.spaces.includes(x.project_id ?? NO_SPACE)) out.spaces = [...out.spaces, x.project_id ?? NO_SPACE];
  if (out.tags.length && !x.tags.some((t) => out.tags.includes(t.id))) out.tags = x.tags.length ? [...out.tags, x.tags[0].id] : [];
  if (out.person !== null && out.person !== (x.assigned_by ?? NO_PERSON)) out.person = x.assigned_by ?? NO_PERSON;
  if (out.waiting != null && !(isWaiting(x) && out.waiting === x.waiting_for)) out.waiting = isWaiting(x) ? x.waiting_for : null;
  return out;
}

/** Умный список, где задача лежит по своим данным */
export function homeOf(x: Task, t = today()): ViewId {
  if (x.status === "inbox") return "inbox";
  if (x.status === "archived") return "archive";
  if (x.status === "done") return !!x.done_at && stampDay(x.done_at) === t ? "today" : "archive";
  if (isWaiting(x)) return "waiting";
  return x.due_date && x.due_date <= t ? "today" : "soon";
}

/** null — менять ничего не нужно: задача и так видна (или поиск прячет её, но это решает закрепление) */
export function followTask(w: Where, tasks: Task[], id: number): Where | null {
  const x = tasks.find((y) => y.id === id);
  if (!x || NO_FOLLOW.includes(w.view) || visible(w, tasks, id)) return null;
  const views: ViewId[] = [w.view];
  if (w.view.startsWith("p:")) {
    if (x.project_id != null && `p:${x.project_id}` !== w.view) views.push(`p:${x.project_id}`);
    else if (x.project_id == null) views.push("tasks");
  } else if (w.view.startsWith("t:") && !x.tags.some((g) => `t:${g.id}` === w.view)) {
    const first = [...x.tags].sort((a, b) => a.name.localeCompare(b.name, "ru"))[0];
    if (first) views.push(`t:${first.id}`);
    views.push("tasks");
  }
  views.push(homeOf(x), "tasks", "archive");
  for (const view of views) {
    const next: Where = { ...w, view, multi: view === w.view ? w.multi : [], filter: adapt(w.filter, x, view) };
    if (visible(next, tasks, id)) return next;
  }
  return null;
}

