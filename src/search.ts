import type { Project, Task } from "./db";

/** Без регистра и без разницы между «е» и «ё» */
export const fold = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е");

/**
 * Запрос целиком, как набран: «прив» находит «Привет», но не «Проверить», «4» только там, где есть цифра 4.
 * Никакой нечёткости и перестановки слов, лишние пробелы не в счёт
 */
export const needle = (q: string) => fold(q).replace(/\s+/g, " ").trim();
const has = (text: string, n: string) => fold(text).replace(/\s+/g, " ").includes(n);

/** Поиск внутри списка, доски и календаря: только по названию задачи, запрос целиком. Порядок не меняется */
export function searchTasks(query: string, tasks: Task[]): Task[] {
  const n = needle(query);
  if (!n) return tasks;
  return tasks.filter((x) => has(x.title, n));
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
