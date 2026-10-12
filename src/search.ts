import type { Project, Task } from "./db";

/** Без регистра и без разницы между «е» и «ё» */
export const fold = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е");

/** Слова запроса: каждое должно найтись, порядок любой */
export const words = (q: string) => fold(q).split(/\s+/).filter(Boolean);

/** Где искать: название, заметка, пункты чеклиста, теги, кто назначил, участники, пространство, подписи ссылок */
function haystack(x: Task, space?: Project): string {
  return fold([
    x.title, x.note, ...x.subtasks.map((s) => s.title), ...x.tags.map((t) => t.name), x.assigned_by ?? "", ...x.participants,
    space?.name ?? "", ...x.links.map((l) => `${l.title} ${l.url}`),
  ].join("\n"));
}

/** Поиск внутри списка, доски и календаря: задачи, где нашлись все слова запроса. Порядок не меняется */
export function searchTasks(query: string, tasks: Task[], projects: Project[] = []): Task[] {
  const ws = words(query);
  if (!ws.length) return tasks;
  return tasks.filter((x) => {
    const hay = haystack(x, projects.find((p) => p.id === x.project_id));
    return ws.every((w) => hay.includes(w));
  });
}

/** Поиск пространств на странице «Пространства»: по названию и описанию */
export function searchProjects(query: string, projects: Project[]): Project[] {
  const ws = words(query);
  if (!ws.length) return projects;
  return projects.filter((p) => {
    const hay = fold(`${p.name}\n${p.description}`);
    return ws.every((w) => hay.includes(w));
  });
}

/** Поиск людей в настройках «Кто назначил»: по имени */
export function searchNames<T extends { name: string }>(query: string, rows: T[]): T[] {
  const ws = words(query);
  if (!ws.length) return rows;
  return rows.filter((r) => ws.every((w) => fold(r.name).includes(w)));
}

/** Куски текста для подсветки найденного: [обычный, найденный, обычный, ...] */
export function marks(text: string, query: string): string[] {
  const ws = words(query);
  if (!ws.length) return [text];
  const low = fold(text);
  if (low.length !== text.length) return [text]; // редкие буквы меняют длину при смене регистра, тогда без подсветки
  const hit = new Array<boolean>(text.length).fill(false);
  for (const w of ws) for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + 1)) hit.fill(true, i, i + w.length);
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
