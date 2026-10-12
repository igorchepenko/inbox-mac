import type { Task } from "./db";
import { searchTasks } from "./search";

/*
 * Теги и «Кто назначил»: чистая логика без базы и React, под тесты.
 * Тег — название от 1 до 16 символов, у задачи до 6 тегов, у каждого тега свой цвет.
 */

export const TAG_MAX_LEN = 16;
export const TAG_MAX = 6;

/**
 * Палитра тегов: 24 чистых цвета из палитры пространств (src/palette.ts), по кругу оттенков.
 * Без приглушённых и тёмных (шоколадный, сланцевый, хвойный, тёмно-синий, чернильный, винный).
 * Порядок важен: pickColor считает расстояние между цветами по номеру в этом списке
 */
export const TAG_COLORS = [
  "scarlet", "coral", "orange", "tangerine", "sunflower", "lemon", "chartreuse", "lime",
  "neon", "green", "emerald", "teal", "cyan", "sky", "cobalt", "royal",
  "indigo", "violet", "purple", "orchid", "magenta", "pink", "raspberry", "rose",
];

/** Название тега как сохраним: без # в начале, без лишних пробелов, не длиннее 16 символов */
export function normalizeTag(raw: string): string {
  return [...raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim()].slice(0, TAG_MAX_LEN).join("").trim();
}

/** Одно и то же имя без учёта регистра, в том числе кириллицы */
export const sameName = (a: string, b: string) => a.toLocaleLowerCase("ru") === b.toLocaleLowerCase("ru");

/**
 * Цвет нового тега: самый далёкий по кругу оттенков от уже занятых.
 * Пока свободные цвета есть, берём из них; когда заняты все 24, начинается второй круг по тому же правилу
 */
export function pickColor(used: string[]): string {
  const n = TAG_COLORS.length;
  const count = TAG_COLORS.map((c) => used.filter((u) => u === c).length);
  const level = Math.min(...count);
  const busy = count.flatMap((k, i) => (k > level ? [i] : []));
  if (!busy.length) return TAG_COLORS[count.indexOf(level)];
  const dist = (i: number) => Math.min(...busy.map((b) => Math.min(Math.abs(i - b), n - Math.abs(i - b))));
  let best = -1;
  for (let i = 0; i < n; i++) if (count[i] === level && (best < 0 || dist(i) > dist(best))) best = i;
  return TAG_COLORS[best];
}

/** Добавить тег к списку: без повторов, не больше шести */
export function addTagName(names: string[], raw: string): string[] {
  const name = normalizeTag(raw);
  if (!name || names.length >= TAG_MAX || names.some((n) => sameName(n, name))) return names;
  return [...names, name];
}

/** Имя человека: как его уже писали раньше, если совпадает без учёта регистра. Иначе как ввели */
export function canonicalPerson(raw: string, people: string[]): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return null;
  return people.find((p) => sameName(p, name)) ?? name;
}

/**
 * Быстрый ввод прямо в названии: «Выгрузить транскрибацию #созвон @Андрей».
 * Тегом считается #слово, в котором есть буква (#123 остаётся в тексте как номер), назначившим первое @Имя
 */
export function parseQuick(text: string): { title: string; tags: string[]; person: string | null } {
  let tags: string[] = [];
  let person: string | null = null;
  const title = text
    .replace(/(^|\s)#([\p{L}\p{N}_-]+)(?=\s|$)/gu, (m, sp: string, word: string) => {
      if (!/\p{L}/u.test(word) || word.length > TAG_MAX_LEN) return m;
      tags = addTagName(tags, word);
      return sp;
    })
    .replace(/(^|\s)@(\p{L}[\p{L}-]*)(?=\s|$)/gu, (m, sp: string, name: string) => {
      if (person) return m;
      person = name;
      return sp;
    })
    .replace(/\s+/g, " ")
    .trim();
  return { title, tags, person };
}

/**
 * Фильтр списка, канбана и календаря. Пространства и теги: задача из любого выбранного (NO_SPACE — без пространства).
 * Человек: null — все, NO_PERSON — без назначившего. Текст: поиск по задаче, все слова запроса должны найтись
 */
export interface TaskFilter {
  spaces: number[];
  tags: number[];
  person: string | null;
  text: string;
}
export const NO_PERSON = "";
export const NO_SPACE = 0;
export const EMPTY_FILTER: TaskFilter = { spaces: [], tags: [], person: null, text: "" };
export const filterOn = (f: TaskFilter) => f.spaces.length > 0 || f.tags.length > 0 || f.person !== null || !!f.text.trim();

export function applyFilter(tasks: Task[], f: TaskFilter): Task[] {
  if (!filterOn(f)) return tasks;
  return searchTasks(f.text, tasks).filter((x) => {
    if (f.spaces.length && !f.spaces.includes(x.project_id ?? NO_SPACE)) return false;
    if (f.tags.length && !x.tags.some((t) => f.tags.includes(t.id))) return false;
    if (f.person === NO_PERSON) return !x.assigned_by;
    if (f.person !== null) return !!x.assigned_by && sameName(x.assigned_by, f.person);
    return true;
  });
}

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
export const byName = (a: string, b: string) => collator.compare(a, b);

/** Первый по алфавиту тег задачи: по нему задача стоит при сортировке по тегам */
export const firstTag = (x: Task): string | null => (x.tags.length ? x.tags.map((t) => t.name).sort(byName)[0] : null);

/** Сначала с тегом (или с назначившим) по алфавиту, без него в конце. Равные решает следующая сортировка */
export function compareNames(a: string | null, b: string | null): number {
  if (a && b) return byName(a, b);
  return (a ? 0 : 1) - (b ? 0 : 1);
}

/** Все люди из задач, по алфавиту, без повторов с разным регистром */
export function peopleOf(tasks: Task[]): string[] {
  const out: string[] = [];
  for (const x of tasks) if (x.assigned_by && !out.some((p) => sameName(p, x.assigned_by!))) out.push(x.assigned_by);
  return out.sort(byName);
}

/** Подсказки при вводе: сначала начинающиеся с набранного, затем содержащие; уже выбранные не предлагаем */
export function suggest(options: string[], query: string, taken: string[] = [], limit = 6): string[] {
  const q = query.trim().replace(/^#/, "").toLocaleLowerCase("ru");
  const free = options.filter((o) => !taken.some((t) => sameName(t, o)));
  if (!q) return free.slice(0, limit);
  const low = (s: string) => s.toLocaleLowerCase("ru");
  const starts = free.filter((o) => low(o).startsWith(q));
  const has = free.filter((o) => !low(o).startsWith(q) && low(o).includes(q));
  return [...starts, ...has].slice(0, limit);
}
