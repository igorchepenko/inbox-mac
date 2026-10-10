import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anchorRule, describe as describeRule, firstOccurrence, nextOccurrence, nthOf, parseRule, type Rule } from "../recurrence";
import { freezeToday } from "./helpers";

beforeEach(freezeToday); // сегодня суббота, 2026-10-10
afterEach(() => vi.useRealTimers());

const next = (rule: Rule, due: string | null, done = "2026-10-10") => nextOccurrence(rule, due, done)?.date;

describe("parseRule", () => {
  it("мусор и пустое значение дают null", () => {
    expect(parseRule(null)).toBeNull();
    expect(parseRule("не json")).toBeNull();
    expect(parseRule("{}")).toBeNull();
  });
  it("читает правило", () => {
    expect(parseRule('{"freq":"day","every":2}')).toEqual({ freq: "day", every: 2 });
  });
});

describe("nextOccurrence", () => {
  it("ежедневная задача на завтра переезжает на следующий день", () => {
    expect(next({ freq: "day", every: 1 }, "2026-10-11")).toBe("2026-10-12");
  });

  it("просроченную не размножает: следующий повтор позже сегодняшнего дня", () => {
    expect(next({ freq: "day", every: 1 }, "2026-09-01")).toBe("2026-10-11");
  });

  it("«каждые 3 дня» по расписанию, а не от дня выполнения", () => {
    expect(next({ freq: "day", every: 3 }, "2026-10-12", "2026-10-10")).toBe("2026-10-15");
  });

  it("fromDone считает от дня выполнения", () => {
    expect(next({ freq: "day", every: 3, fromDone: true }, "2026-10-01")).toBe("2026-10-13");
  });

  it("по будням: после пятницы идёт понедельник", () => {
    const rule: Rule = { freq: "week", every: 1, days: [1, 2, 3, 4, 5] };
    expect(next(rule, "2026-10-16", "2026-10-16")).toBe("2026-10-19");
  });

  it("раз в две недели по понедельникам и четвергам", () => {
    const rule: Rule = { freq: "week", every: 2, days: [1, 4] };
    expect(next(rule, "2026-10-12", "2026-10-12")).toBe("2026-10-15"); // та же неделя, четверг
    expect(next(rule, "2026-10-15", "2026-10-15")).toBe("2026-10-26"); // через неделю пропуск
  });

  it("месяц по числу: 31-е в коротком месяце сдвигается на последний день", () => {
    const rule: Rule = { freq: "month", every: 1, monthBy: "day", day: 31 };
    expect(next(rule, "2026-10-31", "2026-10-31")).toBe("2026-11-30");
    expect(next(rule, "2026-01-31", "2026-10-10")).toBe("2026-10-31"); // просроченную догоняет до ближайшего будущего
  });

  it("месяц по дню недели: 2-й вторник и последняя пятница", () => {
    expect(next({ freq: "month", every: 1, monthBy: "nth", nth: 2, weekday: 2 }, "2026-10-13", "2026-10-13")).toBe("2026-11-10");
    expect(next({ freq: "month", every: 1, monthBy: "nth", nth: -1, weekday: 5 }, "2026-10-30", "2026-10-30")).toBe("2026-11-27");
  });

  it("год: 29 февраля в невисокосный год уходит на 28-е", () => {
    expect(next({ freq: "year", every: 1, month: 2, day: 29 }, "2028-02-29", "2028-02-29")).toBe("2029-02-28");
  });

  it("серия заканчивается по счётчику и по дате", () => {
    expect(nextOccurrence({ freq: "day", every: 1, count: 1 }, "2026-10-11", "2026-10-11")).toBeNull();
    expect(nextOccurrence({ freq: "day", every: 1, until: "2026-10-11" }, "2026-10-11", "2026-10-11")).toBeNull();
  });

  it("счётчик уменьшается на каждом повторе", () => {
    expect(nextOccurrence({ freq: "day", every: 1, count: 3 }, "2026-10-11", "2026-10-11")?.rule.count).toBe(2);
  });
});

describe("выравнивание первой даты", () => {
  it("«каждый понедельник», заданный в субботу, начинается с понедельника", () => {
    expect(firstOccurrence({ freq: "week", every: 1, days: [1] }, "2026-10-10")).toBe("2026-10-12");
  });
  it("правило без привязки начинается сразу", () => {
    expect(firstOccurrence({ freq: "day", every: 1 }, "2026-10-10")).toBe("2026-10-10");
  });
});

describe("nthOf и anchorRule", () => {
  it("последняя пятница месяца", () => {
    expect(nthOf("2026-10-30")).toMatchObject({ weekday: 5, last: true });
    expect(nthOf("2026-10-09")).toMatchObject({ nth: 2, weekday: 5, last: false });
  });
  it("anchorRule подставляет день недели и число месяца из даты", () => {
    expect(anchorRule({ freq: "week", every: 1 }, "2026-10-10").days).toEqual([6]);
    expect(anchorRule({ freq: "month", every: 1, monthBy: "day" }, "2026-10-17").day).toBe(17);
    expect(anchorRule({ freq: "month", every: 1, monthBy: "nth" }, "2026-10-30")).toMatchObject({ nth: -1, weekday: 5 });
  });
});

describe("describe", () => {
  it("человеческие подписи", () => {
    expect(describeRule({ freq: "day", every: 1 })).toBe("Каждый день");
    expect(describeRule({ freq: "week", every: 1, days: [1, 2, 3, 4, 5] })).toBe("По будням");
    expect(describeRule({ freq: "week", every: 2, days: [1, 4] })).toBe("Каждые 2 недели: пн, чт");
    expect(describeRule({ freq: "month", every: 1, monthBy: "nth", nth: -1, weekday: 5 })).toBe("Каждый месяц, в последнюю пятницу");
  });
});
