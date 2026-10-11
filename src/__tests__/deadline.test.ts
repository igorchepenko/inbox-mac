import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  alertAt, alertOf, alertTitle, compareDeadline, deadlineEnd, deadlineState, dueDeadlineAlerts, fmtDeadline, makeDeadline, shiftDeadline,
} from "../deadline";
import { applyFilter, EMPTY_FILTER, NO_SPACE } from "../tags";
import { listFor } from "../views";
import { freezeToday, task } from "./helpers";

beforeEach(freezeToday); // сегодня 2026-10-10, полдень
afterEach(() => vi.useRealTimers());

const NOW = "2026-10-10T12:00";
const ON = { on: true, days: 1, time: "10:00" };

describe("дедлайн", () => {
  it("день или момент со временем", () => {
    expect(makeDeadline("2026-10-12", null)).toBe("2026-10-12");
    expect(makeDeadline("2026-10-12", "18:00")).toBe("2026-10-12T18:00");
    expect(makeDeadline(null, "18:00")).toBeNull();
    expect(deadlineEnd("2026-10-12")).toBe("2026-10-12T23:59");
    expect(deadlineEnd("2026-10-12T18:00")).toBe("2026-10-12T18:00");
  });

  it("подпись", () => {
    expect(fmtDeadline("2026-10-11")).toBe("Завтра");
    expect(fmtDeadline("2026-10-10T18:00")).toBe("Сегодня 18:00");
  });

  it("красный, если срок прошёл, янтарный, если остался день", () => {
    expect(deadlineState(task({ deadline: "2026-10-09" }), NOW)).toBe("overdue");
    expect(deadlineState(task({ deadline: "2026-10-10T11:00" }), NOW)).toBe("overdue");
    expect(deadlineState(task({ deadline: "2026-10-10" }), NOW)).toBe("soon");
    expect(deadlineState(task({ deadline: "2026-10-11T09:00" }), NOW)).toBe("soon");
    expect(deadlineState(task({ deadline: "2026-10-12" }), NOW)).toBeNull();
    expect(deadlineState(task({ deadline: "2026-10-09", status: "done" }), NOW)).toBeNull();
    expect(deadlineState(task(), NOW)).toBeNull();
  });

  it("сортировка: ближайший сверху, без дедлайна в конце", () => {
    const a = task({ id: 1, deadline: "2026-10-15" });
    const b = task({ id: 2 });
    const c = task({ id: 3, deadline: "2026-10-12T09:00" });
    const d = task({ id: 4, deadline: "2026-10-12" });
    expect([a, b, c, d].sort(compareDeadline).map((x) => x.id)).toEqual([3, 4, 1, 2]);
    const list = listFor("soon", [a, b, c, d], "deadline");
    expect(list.map((i) => i.task.id)).toEqual([3, 4, 1, 2]);
    expect(list.filter((i) => i.group).map((i) => i.group)).toEqual(["Дедлайн пн, 12 окт", "Дедлайн чт, 15 окт", "Без дедлайна"]);
  });

  it("повтор сдвигает дедлайн вместе с датой", () => {
    expect(shiftDeadline("2026-10-12T18:00", "2026-10-10", "2026-10-17")).toBe("2026-10-19T18:00");
    expect(shiftDeadline("2026-10-12", null, "2026-10-17")).toBeNull();
    expect(shiftDeadline(null, "2026-10-10", "2026-10-17")).toBeNull();
  });
});

describe("уведомление о дедлайне", () => {
  it("настройки по умолчанию: за день в 10:00", () => {
    expect(alertOf({})).toEqual(ON);
    expect(alertOf({ "deadline.notify": "0", "deadline.days": "3", "deadline.time": "08:30" })).toEqual({ on: false, days: 3, time: "08:30" });
  });

  it("когда приходит", () => {
    expect(alertAt("2026-10-12", ON)).toBe("2026-10-11T10:00");
    expect(alertAt("2026-10-12", { ...ON, days: 0 })).toBe("2026-10-12T10:00");
    // Дедлайн раньше времени уведомления в тот же день: приходит к самому дедлайну
    expect(alertAt("2026-10-12T09:00", { ...ON, days: 0 })).toBe("2026-10-12T09:00");
  });

  it("каждая задача один раз, прошедший дедлайн молча", () => {
    const tasks = [
      task({ id: 1, deadline: "2026-10-11" }), // за день, 10:00 сегодня прошло
      task({ id: 2, deadline: "2026-10-12" }), // рано
      task({ id: 3, deadline: "2026-10-11", deadline_notified: 1 }),
      task({ id: 4, deadline: "2026-10-09" }), // уже прошёл
      task({ id: 5, deadline: "2026-10-11", status: "done" }),
    ];
    expect(dueDeadlineAlerts(tasks, ON, NOW).map((d) => [d.task.id, d.silent])).toEqual([[1, false], [4, true]]);
    expect(dueDeadlineAlerts(tasks, { ...ON, on: false }, NOW).every((d) => d.silent)).toBe(true);
  });

  it("заголовок", () => {
    expect(alertTitle("2026-10-11", NOW)).toBe("Дедлайн завтра");
    expect(alertTitle("2026-10-10T18:00", NOW)).toBe("Дедлайн сегодня в 18:00");
    expect(alertTitle("2026-10-13", NOW)).toBe("Дедлайн через 3 дня");
    expect(alertTitle("2026-10-17", NOW)).toBe("Дедлайн через 7 дней");
  });
});

describe("фильтр по пространствам", () => {
  const all = [task({ id: 1, project_id: 10 }), task({ id: 2, project_id: 20 }), task({ id: 3 })];
  const fid = (spaces: number[]) => applyFilter(all, { ...EMPTY_FILTER, spaces }).map((x) => x.id);
  it("любое из выбранных", () => expect(fid([10, 20])).toEqual([1, 2]));
  it("без пространства", () => expect(fid([NO_SPACE, 20])).toEqual([2, 3]));
  it("пустой — всё", () => expect(fid([])).toEqual([1, 2, 3]));
});
