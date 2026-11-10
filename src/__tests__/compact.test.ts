import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPACT_LISTS, compactItems, dueLabel, dueTone, listIcon, listName } from "../compactLists";
import { freezeToday, task } from "./helpers";

beforeEach(freezeToday); // сегодня 2026-10-10
afterEach(() => vi.useRealTimers());

const ids = (xs: { task: { id: number } }[]) => xs.map((i) => i.task.id);

describe("компактный вид", () => {
  it("шесть списков по порядку, с названиями из меню", () => {
    expect(COMPACT_LISTS.map(listName)).toEqual(["Задачи", "Новые", "Сегодня", "Просроченные", "Скоро", "Жду"]);
  });

  it("иконка списка своя, если её поменяли в главном окне", () => {
    expect(listIcon("today", {})).toBe("sun");
    expect(listIcon("today", { "icon:today": "star" })).toBe("star");
  });

  it("списки те же, что в главном окне", () => {
    const xs = [
      task({ id: 1, status: "inbox" }),
      task({ id: 2, due_date: "2026-10-10" }),
      task({ id: 3, due_date: "2026-10-05" }),
      task({ id: 4, due_date: "2026-10-20" }),
      task({ id: 5, waiting_for: "Аня" }),
      task({ id: 6, status: "done", due_date: "2026-10-10" }),
    ];
    expect(ids(compactItems("tasks", xs)).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(ids(compactItems("inbox", xs))).toEqual([1]);
    expect(ids(compactItems("today", xs))).toEqual([3, 2]);
    expect(ids(compactItems("overdue", xs))).toEqual([3]);
    expect(ids(compactItems("soon", xs))).toEqual([4]);
    expect(ids(compactItems("waiting", xs))).toEqual([5]);
  });

  it("заголовки по дням убраны, люди в «Жду» остаются", () => {
    const xs = [task({ id: 1, due_date: "2026-10-12" }), task({ id: 2, waiting_for: "Аня" })];
    expect(compactItems("soon", xs).every((i) => !i.group)).toBe(true);
    expect(compactItems("waiting", xs)[0].group).toBe("Аня");
  });

  it("сортировка списка берётся из настроек главного окна", () => {
    const xs = [task({ id: 1, due_date: "2026-10-12" }), task({ id: 2, due_date: "2026-10-15" })];
    expect(ids(compactItems("soon", xs))).toEqual([1, 2]);
    expect(ids(compactItems("soon", xs, { "sort:tasks": "date", "sort.rev:tasks:date": "1" }))).toEqual([2, 1]);
  });

  it("дата в строке: день и время, если есть", () => {
    expect(dueLabel(task({ due_date: null }))).toBeNull();
    expect(dueLabel(task({ due_date: "2026-10-10" }))).toBe("Сегодня");
    expect(dueLabel(task({ due_date: "2026-10-11", start_time: "09:30" }))).toBe("Завтра, 09:30");
    expect(dueLabel(task({ due_date: "2026-10-11", end_time: "18:00" }))).toBe("Завтра, до 18:00");
  });

  it("цвет даты: прошедшая красная, сегодняшняя янтарная", () => {
    expect(dueTone(task({ due_date: "2026-10-09" }))).toBe("overdue");
    expect(dueTone(task({ due_date: "2026-10-10" }))).toBe("today");
    expect(dueTone(task({ due_date: "2026-10-11" }))).toBeNull();
  });
});
