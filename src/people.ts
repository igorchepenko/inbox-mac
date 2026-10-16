import { isClosed, type Person, type Task } from "./db";
import { MONTHS_GEN } from "./dates";
import { fold } from "./search";
import { byName, sameName } from "./tags";

/*
 * Люди: чистая логика без базы и React, под тесты.
 * День рождения хранится строкой «ММ-ДД» (год неизвестен) или «ГГГГ-ММ-ДД».
 */

export interface Birthday {
  month: number; // 1…12
  day: number;
  year: number | null;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function parseBirthday(s: string | null | undefined): Birthday | null {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  const year = m[1] ? Number(m[1]) : null;
  if (year != null && day === 29 && month === 2 && !isLeap(year)) return null;
  return { month, day, year };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Собрать строку для базы. Нет дня или месяца — дня рождения нет; несуществующая дата (31 апреля) тоже null */
export function formatBirthday(day: number | null, month: number | null, year: number | null): string | null {
  if (!day || !month) return null;
  const b = year ? `${pad(year, 4)}-${pad(month)}-${pad(day)}` : `${pad(month)}-${pad(day)}`;
  return parseBirthday(b) ? b : null;
}

/** «9 октября» или «9 октября 1990» */
export function fmtBirthday(s: string | null): string {
  const b = parseBirthday(s);
  if (!b) return "";
  return `${b.day} ${MONTHS_GEN[b.month - 1]}${b.year ? ` ${b.year}` : ""}`;
}

/** Выпадает ли день рождения на этот день (ГГГГ-ММ-ДД). 29 февраля в невисокосный год отмечаем 28-го */
export function birthdayOn(p: Pick<Person, "birthday">, day: string): boolean {
  const b = parseBirthday(p.birthday);
  if (!b) return false;
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7)), d = Number(day.slice(8, 10));
  if (b.month === 2 && b.day === 29 && !isLeap(y)) return m === 2 && d === 28;
  return b.month === m && b.day === d;
}

/** Сколько исполняется в этот день; null, если год рождения не указан */
export function ageOn(p: Pick<Person, "birthday">, day: string): number | null {
  const b = parseBirthday(p.birthday);
  if (!b?.year) return null;
  return Number(day.slice(0, 4)) - b.year;
}

/** Именинники дня: исполняется ли возраст — в подсказке */
export const birthdaysOn = (people: Person[], day: string) => people.filter((p) => birthdayOn(p, day)).sort((a, b) => byName(a.name, b.name));

export function birthdayTitle(p: Person, day: string): string {
  const age = ageOn(p, day);
  return `День рождения: ${p.name}${age != null && age > 0 ? `, ${age}` : ""}`;
}

export type PeopleSort = "name" | "birthday" | "company" | "job" | "active";
export const PEOPLE_SORTS: { id: PeopleSort; name: string; hint: string }[] = [
  { id: "name", name: "По алфавиту", hint: "По имени" },
  { id: "birthday", name: "По дню рождения", hint: "Ближайший по календарю года, без даты в конце" },
  { id: "company", name: "По компании", hint: "Компании по алфавиту, без компании в конце" },
  { id: "job", name: "По должности", hint: "Должности по алфавиту, без должности в конце" },
  { id: "active", name: "По активным задачам", hint: "Больше всего активных задач сверху. Отменённые и завершённые не считаются" },
];

/** Подпись направления для подсказки: что значит «вперёд» и «назад» при этой сортировке */
export function peopleDirection(sort: PeopleSort, rev: boolean): { asc: boolean; text: string } {
  if (sort === "birthday") return { asc: !rev, text: rev ? "с конца года" : "с 1 января" };
  if (sort === "active") return { asc: rev, text: rev ? "сначала с меньшим числом задач" : "сначала с большим числом задач" };
  return { asc: !rev, text: rev ? "от Я к А" : "от А к Я" };
}

/** День рождения как число для сортировки «от 1 января»: месяц*100 + день; без даты null */
export function birthdayRank(p: Pick<Person, "birthday">): number | null {
  const b = parseBirthday(p.birthday);
  return b ? b.month * 100 + b.day : null;
}

/**
 * Сначала с значением, без него в конце. rev разворачивает только порядок значений. Равные идут по имени.
 * Для «active» нужны числа активных задач по id человека (см. activeCount)
 */
export function sortPeople(people: Person[], sort: PeopleSort, rev = false, active?: Map<number, number>): Person[] {
  const key = (p: Person): string | number | null => {
    if (sort === "birthday") return birthdayRank(p);
    if (sort === "company") return p.company.trim() || null;
    if (sort === "job") return p.job_title.trim() || null;
    if (sort === "active") return -(active?.get(p.id) ?? 0);
    return p.name;
  };
  return [...people].sort((a, b) => {
    const x = key(a), y = key(b);
    if (x == null || y == null) {
      if (x != null || y != null) return x == null ? 1 : -1;
    } else if (x !== y) {
      const c = typeof x === "number" ? x - (y as number) : byName(x, y as string);
      if (c) return rev ? -c : c;
    }
    return byName(a.name, b.name);
  });
}

/** Поиск по имени: запрос целиком, без регистра, ё = е */
export function searchPeople(query: string, people: Person[]): Person[] {
  const q = fold(query).replace(/\s+/g, " ").trim();
  if (!q) return people;
  return people.filter((p) => fold(p.name).replace(/\s+/g, " ").includes(q));
}

/** Фильтры страницы «Люди»: внутри группы «любой из выбранных», группы складываются через «и» */
export interface PeopleFilter {
  companies: string[];
  jobs: string[];
  tags: number[];
}
export const EMPTY_PEOPLE_FILTER: PeopleFilter = { companies: [], jobs: [], tags: [] };
export const peopleFilterCount = (f: PeopleFilter) => f.companies.length + f.jobs.length + f.tags.length;

const same = (a: string, b: string) => fold(a).trim() === fold(b).trim();

export function filterPeople(people: Person[], f: PeopleFilter): Person[] {
  if (!peopleFilterCount(f)) return people;
  return people.filter((p) =>
    (!f.companies.length || f.companies.some((c) => same(c, p.company))) &&
    (!f.jobs.length || f.jobs.some((j) => same(j, p.job_title))) &&
    (!f.tags.length || p.tags.some((t) => f.tags.includes(t.id))));
}

/** Значения для фильтров «Компания» и «Должность»: без повторов (регистр не важен), по алфавиту */
export function distinctValues(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const t = v.trim();
    if (t && !seen.has(fold(t))) seen.set(fold(t), t);
  }
  return [...seen.values()].sort(byName);
}

/** Сколько задач у человека: он назначил или был участником встречи */
export function taskCount(name: string, tasks: Task[]): number {
  return tasks.filter((x) => (x.assigned_by && sameName(x.assigned_by, name)) || x.participants.some((n) => sameName(n, name))).length;
}

/** То же, но только активные: без завершённых и отменённых */
export function activeCount(name: string, tasks: Task[]): number {
  return taskCount(name, tasks.filter((x) => !isClosed(x)));
}

/** Какие поля видны в строке списка людей. Храним скрытые, как и поля задач: новое поле появится у всех */
export type PeopleFieldId = "work" | "tags" | "contacts" | "birthday" | "tasks";
export const PEOPLE_FIELDS: { id: PeopleFieldId; name: string; hint: string }[] = [
  { id: "work", name: "Должность и компания", hint: "Под именем" },
  { id: "tags", name: "Теги", hint: "Те же, что у задач" },
  { id: "contacts", name: "Телефон и Telegram", hint: "Клик копирует в буфер обмена" },
  { id: "birthday", name: "День рождения", hint: "Клик открывает календарь на этот день" },
  { id: "tasks", name: "Задачи", hint: "Число задач человека" },
];
export const PEOPLE_FIELDS_KEY = "fields:people";

export function hiddenPeopleFields(settings: Record<string, string>): PeopleFieldId[] {
  try {
    const xs = JSON.parse(settings[PEOPLE_FIELDS_KEY] ?? "[]");
    return Array.isArray(xs) ? PEOPLE_FIELDS.map((f) => f.id).filter((id) => xs.includes(id)) : [];
  } catch {
    return [];
  }
}

/** Новое значение ключа после переключения одного поля */
export function togglePeopleField(settings: Record<string, string>, id: PeopleFieldId, on: boolean): string {
  const hidden = hiddenPeopleFields(settings).filter((x) => x !== id);
  if (!on) hidden.push(id);
  return JSON.stringify(PEOPLE_FIELDS.map((f) => f.id).filter((x) => hidden.includes(x)));
}

/** Колонки строки: у каждого скрытого поля колонка пропадает */
export function peopleColumns(hidden: PeopleFieldId[]): string {
  const on = (id: PeopleFieldId) => !hidden.includes(id);
  return ["18px", "30px", "minmax(150px, 1.3fr)", on("tags") && "minmax(0, 1fr)", on("contacts") && "minmax(0, 1.1fr)", on("birthday") && "120px", on("tasks") && "80px"]
    .filter(Boolean).join(" ");
}

/** Событие «записать человека» из горячей клавиши N, пока открыт раздел «Люди» */
export const NEW_PERSON_EVENT = "inbox:new-person";

/** Ник Telegram как храним: без @ и пробелов, а из ссылки t.me/ник берём ник */
export function normalizeTelegram(raw: string): string {
  return raw.trim().replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//i, "").replace(/^@+/, "").replace(/\s+/g, "").replace(/[/?#].*$/, "");
}
