// Повторяющиеся задачи. Правило хранится в tasks.recurrence как JSON.
// Когда повторяющуюся задачу отмечают сделанной, она уходит в историю, а рядом создаётся
// следующая с новой датой (db.completeTask). Так у каждого повтора своя отметка и свой чеклист.
import { addDays, dayKey, dayMonth, daysBetween, daysInMonth, isoWeekday, MONTHS_GEN, parseDay, today, weekStart } from "./dates";

export type Freq = "day" | "week" | "month" | "year";

export interface Rule {
  freq: Freq;
  every: number; // каждые N дней, недель, месяцев, лет
  days?: number[]; // неделя: дни 1 Пн … 7 Вс; пусто — тот же день недели, что у даты
  monthBy?: "day" | "nth"; // месяц: тем же числом или «2-й вторник», «последняя пятница»
  day?: number; // месяц по числу и год: число месяца
  month?: number; // год: месяц 1…12
  nth?: number; // месяц по дню недели: 1…4 или -1 (последний)
  weekday?: number; // месяц по дню недели: 1 Пн … 7 Вс
  fromDone?: boolean; // считать от дня выполнения, а не по расписанию
  until?: string | null; // не повторять после этого дня
  count?: number | null; // сколько раз осталось, включая текущий
}

export function parseRule(json: string | null | undefined): Rule | null {
  if (!json) return null;
  try {
    const r = JSON.parse(json) as Rule;
    return r && r.freq ? r : null;
  } catch {
    return null;
  }
}

/** Какой по счёту этот день недели в месяце (1…4) и последний ли он: «2-й вторник», «последняя пятница» */
export function nthOf(day: string): { nth: number; weekday: number; last: boolean } {
  const d = parseDay(day);
  const nth = Math.ceil(d.getDate() / 7);
  return { nth: Math.min(nth, 4), weekday: isoWeekday(d), last: d.getDate() + 7 > daysInMonth(d.getFullYear(), d.getMonth()) };
}

/** День «nth weekday» месяца: 2-й вторник, последняя пятница */
function nthWeekday(y: number, m0: number, nth: number, weekday: number): Date {
  if (nth === -1) {
    const d = new Date(y, m0, daysInMonth(y, m0));
    while (isoWeekday(d) !== weekday) d.setDate(d.getDate() - 1);
    return d;
  }
  const d = new Date(y, m0, 1);
  while (isoWeekday(d) !== weekday) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 7 * (nth - 1));
  return d;
}

/** Ближайший после base день по правилу (без учёта окончания) */
function step(rule: Rule, base: string): string {
  const every = Math.max(1, rule.every || 1);
  const b = parseDay(base);
  switch (rule.freq) {
    case "day":
      return addDays(base, every);
    case "week": {
      const days = rule.days?.length ? rule.days : [isoWeekday(b)];
      const w0 = weekStart(base);
      for (let i = 1; i <= 7 * every + 7; i++) {
        const day = addDays(base, i);
        const week = daysBetween(w0, weekStart(day)) / 7;
        if (week % every === 0 && days.includes(isoWeekday(parseDay(day)))) return day;
      }
      return addDays(base, 7 * every);
    }
    case "month": {
      const y = b.getFullYear(), m0 = b.getMonth() + every;
      if (rule.monthBy === "nth") return dayKey(nthWeekday(y, m0, rule.nth ?? 1, rule.weekday ?? isoWeekday(b)));
      const target = new Date(y, m0, 1);
      const day = Math.min(rule.day ?? b.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
      return dayKey(new Date(target.getFullYear(), target.getMonth(), day));
    }
    case "year": {
      const y = b.getFullYear() + every, m0 = (rule.month ?? b.getMonth() + 1) - 1;
      return dayKey(new Date(y, m0, Math.min(rule.day ?? b.getDate(), daysInMonth(y, m0))));
    }
  }
}

/** Подходит ли день под правило: для выравнивания первой даты */
function matches(rule: Rule, day: string): boolean {
  const d = parseDay(day);
  if (rule.freq === "week") return !rule.days?.length || rule.days.includes(isoWeekday(d));
  if (rule.freq === "month" && rule.monthBy === "nth") {
    const target = nthWeekday(d.getFullYear(), d.getMonth(), rule.nth ?? 1, rule.weekday ?? 1);
    return dayKey(target) === day;
  }
  if (rule.freq === "month" && rule.day) return d.getDate() === Math.min(rule.day, daysInMonth(d.getFullYear(), d.getMonth()));
  return true;
}

/** Первая дата серии не раньше from: «каждый понедельник», заданный в четверг, начнётся с понедельника */
export function firstOccurrence(rule: Rule, from: string): string {
  let d = from;
  for (let i = 0; i < 400 && !matches(rule, d); i++) d = addDays(d, 1);
  return d;
}

/**
 * Следующий повтор после выполнения. due — дата текущей задачи, doneDay — день выполнения.
 * Пропущенные даты в прошлом не создаются: следующий повтор всегда позже сегодняшнего дня.
 * null — серия закончилась.
 */
export function nextOccurrence(rule: Rule, due: string | null, doneDay: string): { date: string; rule: Rule } | null {
  if (rule.count != null && rule.count <= 1) return null;
  const t = today();
  let next = step(rule, rule.fromDone || !due ? doneDay : due);
  // Просроченную догоняем: следующий повтор всегда позже дня выполнения
  const floor = doneDay > t ? doneDay : t;
  for (let i = 0; next <= floor && i < 1000; i++) next = step(rule, next);
  if (rule.until && next > rule.until) return null;
  return { date: next, rule: rule.count != null ? { ...rule, count: rule.count - 1 } : rule };
}

/** Заполняет в правиле число месяца, день недели и т.п. по дате задачи */
export function anchorRule(rule: Rule, day: string): Rule {
  const d = parseDay(day);
  const r: Rule = { ...rule };
  if (r.freq === "week" && !r.days?.length) r.days = [isoWeekday(d)];
  if (r.freq === "month") {
    if (r.monthBy === "nth") {
      const n = nthOf(day);
      r.nth ??= n.last && n.nth >= 4 ? -1 : n.nth;
      r.weekday ??= n.weekday;
    } else r.day ??= d.getDate();
  }
  if (r.freq === "year") {
    r.month ??= d.getMonth() + 1;
    r.day ??= d.getDate();
  }
  return r;
}

export const PRESETS: { name: string; rule: Rule }[] = [
  { name: "Каждый день", rule: { freq: "day", every: 1 } },
  { name: "По будням", rule: { freq: "week", every: 1, days: [1, 2, 3, 4, 5] } },
  { name: "Каждую неделю", rule: { freq: "week", every: 1 } },
  { name: "Каждый месяц", rule: { freq: "month", every: 1, monthBy: "day" } },
  { name: "Каждый год", rule: { freq: "year", every: 1 } },
];

export const WD_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const WD_ACC = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"];
const NTH = ["", "1-й", "2-й", "3-й", "4-й"];

function unit(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

export function nthLabel(nth: number, weekday: number): string {
  const w = WD_ACC[weekday - 1];
  const fem = weekday === 3 || weekday === 5 || weekday === 6; // среда, пятница, суббота
  const neu = weekday === 7;
  if (nth === -1) return `в последн${fem ? "юю" : neu ? "ее" : "ий"} ${w}`;
  return `в ${NTH[nth]} ${w}`;
}

/** «По будням», «Каждые 2 недели: пн, чт», «Каждый месяц, в последнюю пятницу» */
export function describe(rule: Rule): string {
  const n = Math.max(1, rule.every || 1);
  let s: string;
  if (rule.freq === "day") s = n === 1 ? "Каждый день" : `Каждые ${n} ${unit(n, "день", "дня", "дней")}`;
  else if (rule.freq === "week") {
    const days = [...(rule.days ?? [])].sort();
    if (n === 1 && days.join() === "1,2,3,4,5") s = "По будням";
    else if (n === 1 && days.join() === "6,7") s = "По выходным";
    else {
      s = n === 1 ? "Каждую неделю" : `Каждые ${n} ${unit(n, "неделю", "недели", "недель")}`;
      if (days.length) s += `: ${days.map((d) => WD_SHORT[d - 1]).join(", ")}`;
    }
  } else if (rule.freq === "month") {
    s = n === 1 ? "Каждый месяц" : `Каждые ${n} ${unit(n, "месяц", "месяца", "месяцев")}`;
    if (rule.monthBy === "nth" && rule.weekday) s += `, ${nthLabel(rule.nth ?? 1, rule.weekday)}`;
    else if (rule.day) s += `, ${rule.day} числа`;
  } else {
    s = n === 1 ? "Каждый год" : `Каждые ${n} ${unit(n, "год", "года", "лет")}`;
    if (rule.day && rule.month) s += `, ${rule.day} ${MONTHS_GEN[rule.month - 1]}`;
  }
  if (rule.fromDone) s += ", от выполнения";
  if (rule.until) {
    s += `, до ${dayMonth(parseDay(rule.until))}`;
  }
  if (rule.count != null) s += `, ещё ${rule.count} ${unit(rule.count, "раз", "раза", "раз")}`;
  return s;
}
