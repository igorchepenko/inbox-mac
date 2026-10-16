import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countFor, listFor } from "../views";
import { isWaiting, pingDue, presetDate } from "../waiting";
import { freezeToday, task } from "./helpers";

beforeEach(freezeToday); // сегодня 2026-10-10
afterEach(() => vi.useRealTimers());

const ids = (xs: { task: { id: number } }[]) => xs.map((i) => i.task.id);

describe("статус «Жду»", () => {
  it("ждёт только открытая задача с именем", () => {
    expect(isWaiting(task({ waiting_for: "Андрей" }))).toBe(true);
    expect(isWaiting(task({ waiting_for: null }))).toBe(false);
    expect(isWaiting(task({ waiting_for: "Андрей", status: "done" }))).toBe(false);
    expect(isWaiting(task({ waiting_for: "Андрей", status: "archived" }))).toBe(false);
  });

  it("пора напомнить в день напоминания и позже, раньше нет", () => {
    expect(pingDue(task({ waiting_for: "А", waiting_until: "2026-10-10" }))).toBe(true);
    expect(pingDue(task({ waiting_for: "А", waiting_until: "2026-10-08" }))).toBe(true);
    expect(pingDue(task({ waiting_for: "А", waiting_until: "2026-10-11" }))).toBe(false);
    expect(pingDue(task({ waiting_for: "А", waiting_until: null }))).toBe(false);
    expect(pingDue(task({ waiting_for: null, waiting_until: "2026-10-08" }))).toBe(false);
  });

  it("быстрые сроки считаются от сегодняшнего дня", () => {
    expect(presetDate(2)).toBe("2026-10-12");
    expect(presetDate(7)).toBe("2026-10-17");
  });

  it("уходит из «Сегодня» и «Скоро», видна в «Жду» и «Задачах»", () => {
    const w = task({ id: 1, waiting_for: "Андрей", due_date: "2026-10-10", waiting_until: "2026-10-15" });
    const w2 = task({ id: 2, waiting_for: "Андрей", due_date: "2026-10-20" });
    const plain = task({ id: 3, due_date: "2026-10-10" });
    const all = [w, w2, plain];
    expect(ids(listFor("today", all))).toEqual([3]);
    expect(ids(listFor("soon", all))).toEqual([]);
    expect(ids(listFor("waiting", all))).toEqual([1, 2]);
    expect(ids(listFor("tasks", all)).sort()).toEqual([1, 2, 3]);
    expect(countFor("waiting", all)).toBe(2);
  });

  it("в день напоминания возвращается в «Сегодня», даже без срока", () => {
    const a = task({ id: 1, waiting_for: "Андрей", waiting_until: "2026-10-10" });
    const b = task({ id: 2, waiting_for: "Андрей", due_date: "2026-10-09", waiting_until: "2026-10-12" });
    expect(ids(listFor("today", [a, b]))).toEqual([1]);
    // и по-прежнему в «Жду»
    expect(ids(listFor("waiting", [a, b]))).toEqual([1, 2]);
  });

  it("после «Пришёл ответ» задача снова обычная", () => {
    const x = task({ id: 1, waiting_for: null, waiting_until: null, due_date: "2026-10-10" });
    expect(ids(listFor("today", [x]))).toEqual([1]);
    expect(listFor("waiting", [x])).toEqual([]);
  });

  it("«Жду» сгруппировано по людям, раньше те, кому пора напомнить", () => {
    const a = task({ id: 1, waiting_for: "Борис", waiting_until: "2026-10-20" });
    const b = task({ id: 2, waiting_for: "Андрей", waiting_until: "2026-10-20" });
    const c = task({ id: 3, waiting_for: "андрей", waiting_until: "2026-10-09" });
    const items = listFor("waiting", [a, b, c]);
    expect(ids(items)).toEqual([3, 2, 1]);
    expect(items.map((i) => i.group)).toEqual(["андрей", undefined, "Борис"]);
  });

  it("закрытая задача не попадает в «Жду»", () => {
    expect(listFor("waiting", [task({ waiting_for: "Андрей", status: "done" })])).toEqual([]);
  });
});
