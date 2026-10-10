import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, addMonths, daysBetween, daysInMonth, fmtDay, fmtDuration, fmtMin, isoWeekday, monthEnd, monthStart, nextMonday, parseDay, toHHMM, toMin, weekStart } from "../dates";
import { freezeToday } from "./helpers";

beforeEach(freezeToday);
afterEach(() => vi.useRealTimers());

describe("дни", () => {
  it("addDays переходит через границу месяца и года", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("daysBetween считает в обе стороны", () => {
    expect(daysBetween("2026-10-01", "2026-10-10")).toBe(9);
    expect(daysBetween("2026-10-10", "2026-10-01")).toBe(-9);
  });

  it("неделя начинается с понедельника, воскресенье относится к прошлому понедельнику", () => {
    expect(weekStart("2026-10-10")).toBe("2026-10-05"); // суббота
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // воскресенье
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(isoWeekday(parseDay("2026-10-11"))).toBe(7);
  });

  it("границы месяца, в том числе високосный февраль", () => {
    expect(monthStart("2026-10-17")).toBe("2026-10-01");
    expect(monthEnd("2026-10-17")).toBe("2026-10-31");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
    expect(daysInMonth(2026, 1)).toBe(28);
  });

  it("addMonths возвращает первое число и не ломается на 31-м", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
  });

  it("nextMonday всегда строго после сегодняшнего дня", () => {
    expect(nextMonday()).toBe("2026-10-12");
    expect(nextMonday("2026-10-12")).toBe("2026-10-19");
  });
});

describe("время дня", () => {
  it("toMin и toHHMM обратны друг другу", () => {
    expect(toMin("09:30")).toBe(570);
    expect(toMin("9:05")).toBe(545);
    expect(toHHMM(570)).toBe("09:30");
  });

  it("конец суток хранится как 23:59", () => {
    expect(toHHMM(24 * 60)).toBe("23:59");
  });

  it("подписи длительности и времени", () => {
    expect(fmtMin(570)).toBe("9:30");
    expect(fmtDuration(45)).toBe("45 мин");
    expect(fmtDuration(60)).toBe("1 ч");
    expect(fmtDuration(90)).toBe("1 ч 30 мин");
    expect(fmtDuration(0)).toBe("0 мин");
  });
});

describe("fmtDay", () => {
  it("вчера, сегодня, завтра", () => {
    expect(fmtDay("2026-10-09")).toBe("Вчера");
    expect(fmtDay("2026-10-10")).toBe("Сегодня");
    expect(fmtDay("2026-10-11")).toBe("Завтра");
  });

  it("год показывается, только если он не текущий", () => {
    expect(fmtDay("2026-10-16")).toBe("Пт, 16 окт");
    expect(fmtDay("2027-01-05")).toBe("Вт, 5 янв 2027");
  });
});
