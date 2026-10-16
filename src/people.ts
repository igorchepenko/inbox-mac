import type { Person, Task } from "./db";
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

export type PeopleSort = "name" | "birthday" | "tag" | "company" | "job";
export const PEOPLE_SORTS: { id: PeopleSort; name: string }[] = [
  { id: "name", name: "По алфавиту" },
  { id: "birthday", name: "По дню рождения" },
  { id: "tag", name: "По тегу" },
  { id: "company", name: "По компании" },
  { id: "job", name: "По должности" },
];

const firstTagName = (p: Person) => (p.tags.length ? p.tags.map((t) => t.name).sort(byName)[0] : null);

/** День рождения как число для сортировки «от 1 января»: месяц*100 + день; без даты null */
export function birthdayRank(p: Pick<Person, "birthday">): number | null {
  const b = parseBirthday(p.birthday);
  return b ? b.month * 100 + b.day : null;
}

/** Сначала с значением, без него в конце. rev разворачивает только порядок значений. Равные идут по имени */
export function sortPeople(people: Person[], sort: PeopleSort, rev = false): Person[] {
  const key = (p: Person): string | number | null => {
    if (sort === "birthday") return birthdayRank(p);
    if (sort === "tag") return firstTagName(p);
    if (sort === "company") return p.company.trim() || null;
    if (sort === "job") return p.job_title.trim() || null;
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

const digits = (s: string) => s.replace(/\D/g, "");
const tg = (s: string) => fold(s).replace(/^@/, "");

/**
 * Поиск по имени, тегам, компании, должности, телефону и нику в Telegram. Запрос целиком, без регистра;
 * телефон ищется по цифрам («915 12» найдёт «+7 (915) 123-45-67»), ник с @ и без
 */
export function searchPeople(query: string, people: Person[]): Person[] {
  const q = fold(query).replace(/\s+/g, " ").trim();
  if (!q) return people;
  const qd = digits(q);
  const qt = tg(q);
  const text = (s: string) => fold(s).replace(/\s+/g, " ").includes(q);
  return people.filter((p) =>
    text(p.name) || text(p.company) || text(p.job_title) || p.tags.some((t) => text(t.name)) ||
    (qd.length >= 2 && /^[\d\s+()-]+$/.test(q) && digits(p.phone).includes(qd)) || text(p.phone) ||
    (qt.length > 0 && tg(p.telegram).includes(qt)));
}

/** Сколько задач у человека: он назначил или был участником встречи */
export function taskCount(name: string, tasks: Task[]): number {
  return tasks.filter((x) => (x.assigned_by && sameName(x.assigned_by, name)) || x.participants.some((n) => sameName(n, name))).length;
}

/** Ник Telegram как храним: без @ и пробелов, а из ссылки t.me/ник берём ник */
export function normalizeTelegram(raw: string): string {
  return raw.trim().replace(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//i, "").replace(/^@+/, "").replace(/\s+/g, "").replace(/[/?#].*$/, "");
}
