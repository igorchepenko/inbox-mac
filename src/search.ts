import type { Project, Task } from "./db";

/** Без регистра и без разницы между «е» и «ё» */
export const fold = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е");

/**
 * Запрос целиком, как набран: «прив» находит «Привет», но не «Проверить», «4» только там, где есть цифра 4.
 * Никакой нечёткости и перестановки слов, лишние пробелы не в счёт
 */
export const needle = (q: string) => fold(q).replace(/\s+/g, " ").trim();
const has = (text: string, n: string) => fold(text).replace(/\s+/g, " ").includes(n);

/** Где у задачи нашёлся запрос. Адреса ссылок не смотрим: в них случайные буквы и цифры, совпадение там не видно */
export type Where = "title" | "note" | "checklist" | "tags" | "assignee" | "participants" | "space" | "links";
export const WHERE_NAMES: Record<Where, string> = {
  title: "в названии", note: "в заметке", checklist: "в чеклисте", tags: "в тегах", assignee: "в «Кто назначил»",
  participants: "в участниках", space: "в пространстве", links: "в названии ссылки",
};

function fieldsOf(x: Task, space?: Project): [Where, string[]][] {
  return [
    ["title", [x.title]], ["note", [x.note]], ["checklist", x.subtasks.map((s) => s.title)], ["tags", x.tags.map((t) => t.name)],
    ["assignee", [x.assigned_by ?? ""]], ["participants", x.participants], ["space", [space?.name ?? ""]], ["links", x.links.map((l) => l.title)],
  ];
}

/** Первое поле, где нашёлся запрос, или null. Пустой запрос находится в названии */
export function foundIn(x: Task, query: string, space?: Project): Where | null {
  const n = needle(query);
  if (!n) return "title";
  return fieldsOf(x, space).find(([, texts]) => texts.some((t) => has(t, n)))?.[0] ?? null;
}

/** Поиск внутри списка, доски и календаря: задачи, где нашёлся запрос целиком. Порядок не меняется */
export function searchTasks(query: string, tasks: Task[], projects: Project[] = []): Task[] {
  if (!needle(query)) return tasks;
  return tasks.filter((x) => foundIn(x, query, projects.find((p) => p.id === x.project_id)) != null);
}

/** Поиск пространств на странице «Пространства»: по названию и описанию */
export function searchProjects(query: string, projects: Project[]): Project[] {
  const n = needle(query);
  if (!n) return projects;
  return projects.filter((p) => has(p.name, n) || has(p.description, n));
}

/** Поиск людей в настройках «Кто назначил»: по имени */
export function searchNames<T extends { name: string }>(query: string, rows: T[]): T[] {
  const n = needle(query);
  if (!n) return rows;
  return rows.filter((r) => has(r.name, n));
}

/** Куски текста для подсветки найденного: [обычный, найденный, обычный, ...] */
export function marks(text: string, query: string): string[] {
  const n = needle(query);
  if (!n) return [text];
  const low = fold(text);
  if (low.length !== text.length) return [text]; // редкие буквы меняют длину при смене регистра, тогда без подсветки
  const hit = new Array<boolean>(text.length).fill(false);
  for (let i = low.indexOf(n); i >= 0; i = low.indexOf(n, i + 1)) hit.fill(true, i, i + n.length);
  const out: string[] = [];
  let cur = "", on = false;
  for (let i = 0; i < text.length; i++) {
    if (hit[i] !== on) {
      out.push(cur);
      cur = "";
      on = hit[i];
    }
    cur += text[i];
  }
  out.push(cur);
  return out;
}
