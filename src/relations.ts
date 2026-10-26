import type { Task } from "./db";

// db.ts импортирует этот файл, поэтому isClosed отсюда не берём
const isClosed = (x: Pick<Task, "status">) => x.status === "done" || x.status === "archived";

/*
 * Связи задач: «блокирует» (у второй задачи это «заблокирована») и «связана». Хранится одна строка на пару
 * (task_relations), а у каждой задачи loadTasks раскладывает их в Task.relations уже с её стороны.
 * Блокировка мягкая: заблокированную можно завершить, но приложение спросит. Закрытая блокирующая
 * (сделана или отменена) блокировку снимает. Чистая логика под тесты.
 */

export type RelationKind = "blocks" | "blocked" | "related";

/** Связь с точки зрения одной задачи: чем она приходится другой задаче */
export interface Relation {
  id: number; // строка task_relations
  kind: RelationKind;
  other_id: number;
  other_title: string;
  other_closed: boolean;
}

/** Строка таблицы: from блокирует to, либо связаны */
export interface RelationRow {
  id: number;
  from_id: number;
  to_id: number;
  kind: "blocks" | "related";
}

export const RELATION_NAMES: Record<RelationKind, string> = {
  blocks: "Блокирует",
  blocked: "Заблокирована",
  related: "Связана",
};

/** Что делает выбранная связь при добавлении: подсказка под переключателем */
export const RELATION_HINTS: Record<RelationKind, string> = {
  blocks: "Эта задача мешает начать выбранную",
  blocked: "Выбранная задача должна быть закончена раньше этой",
  related: "Просто связь, без последствий",
};

/** Связи каждой задачи с её стороны. Строки на несуществующие задачи пропускаем */
export function relationsByTask(rows: RelationRow[], tasks: Pick<Task, "id" | "title" | "status">[]): Map<number, Relation[]> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Map<number, Relation[]>();
  const push = (id: number, r: Relation) => out.set(id, [...(out.get(id) ?? []), r]);
  for (const r of rows) {
    const a = byId.get(r.from_id), b = byId.get(r.to_id);
    if (!a || !b) continue;
    push(a.id, { id: r.id, kind: r.kind, other_id: b.id, other_title: b.title, other_closed: isClosed(b) });
    push(b.id, { id: r.id, kind: r.kind === "blocks" ? "blocked" : "related", other_id: a.id, other_title: a.title, other_closed: isClosed(a) });
  }
  return out;
}

/** Открытые задачи, из-за которых эта ещё не может начаться */
export const openBlockers = (x: Pick<Task, "relations">) => x.relations.filter((r) => r.kind === "blocked" && !r.other_closed);

/** Заблокирована: закрытая задача никем не заблокирована */
export const isBlocked = (x: Pick<Task, "status" | "relations">) => !isClosed(x) && openBlockers(x).length > 0;

/** Сколько открытых задач ждут эту */
export const blockingCount = (x: Pick<Task, "status" | "relations">) =>
  isClosed(x) ? 0 : x.relations.filter((r) => r.kind === "blocks" && !r.other_closed).length;

/** Связей «связана» */
export const relatedCount = (x: Pick<Task, "relations">) => x.relations.filter((r) => r.kind === "related").length;

/** Добавление «from блокирует to» замкнёт цикл, если to уже (прямо или через другие) блокирует from */
export function wouldCycle(rows: Pick<RelationRow, "from_id" | "to_id" | "kind">[], from: number, to: number): boolean {
  if (from === to) return true;
  const next = new Map<number, number[]>();
  for (const r of rows) if (r.kind === "blocks") next.set(r.from_id, [...(next.get(r.from_id) ?? []), r.to_id]);
  const seen = new Set<number>();
  const stack = [to];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

/** Строка для записи: kind «заблокирована» — это «блокирует» с другой стороны */
export function rowFor(self: number, other: number, kind: RelationKind): Pick<RelationRow, "from_id" | "to_id" | "kind"> {
  if (kind === "blocked") return { from_id: other, to_id: self, kind: "blocks" };
  return { from_id: self, to_id: other, kind };
}

/** Задачи, которые можно связать с этой: открытые не нужны, связывать можно и с закрытыми, но не с собой и не с уже связанными */
export function candidates(tasks: Task[], self: Task, query: string, limit = 6): Task[] {
  const q = query.trim().toLowerCase();
  const taken = new Set([self.id, ...self.relations.map((r) => r.other_id)]);
  return tasks
    .filter((t) => !taken.has(t.id) && t.status !== "archived" && (!q || t.title.toLowerCase().includes(q)))
    .sort((a, b) => Number(isClosed(a)) - Number(isClosed(b)))
    .slice(0, limit);
}
