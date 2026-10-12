import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listFor, progressFor } from "../views";
import { boardFor, canMove, stageOf } from "../boardOps";
import { isCancelled, isDoneReal } from "../db";
import { searchTasks } from "../search";
import { meetingStats, summary } from "../home/data";
import { freezeToday, task, TODAY } from "./helpers";

beforeEach(freezeToday); // сегодня 2026-10-10
afterEach(() => vi.useRealTimers());

const closed = `${TODAY}T11:00:00`;
const done = (p = {}) => task({ status: "done", done_at: closed, due_date: TODAY, ...p });
const cancelled = (p = {}) => done({ cancelled: 1, ...p });

describe("статус «Отменено»", () => {
  it("этап: отменённая в своём столбце, в том числе из архива", () => {
    expect(stageOf(cancelled())).toBe("cancelled");
    expect(stageOf(cancelled({ status: "archived" }))).toBe("cancelled");
    expect(stageOf(done())).toBe("done");
    expect(isCancelled(task({ cancelled: 1 }))).toBe(false); // открытая с пометкой не считается отменённой
    expect(isDoneReal(cancelled())).toBe(false);
  });

  it("отменить можно из любого этапа, кроме сделанной", () => {
    expect(canMove(task({ status: "inbox" }), "cancelled")).toBe(true);
    expect(canMove(task(), "cancelled")).toBe(true);
    expect(canMove(done(), "cancelled")).toBe(false);
    expect(canMove(done({ status: "archived" }), "cancelled")).toBe(false);
    expect(canMove(cancelled(), "done")).toBe(true);
  });

  it("канбан: четвёртый столбец «Отменено»", () => {
    const cols = boardFor("today", [task({ id: 1 }), done({ id: 2 }), cancelled({ id: 3 })], "date");
    expect(cols.map((c) => c.key)).toEqual(["new", "todo", "done", "cancelled"]);
    expect(cols[3].items.map((i) => i.task.id)).toEqual([3]);
    expect(cols[2].items.map((i) => i.task.id)).toEqual([2]);
  });

  it("в списке отменённые ниже сделанных, с отдельной группой", () => {
    const xs = [cancelled({ id: 1, priority: 5 }), done({ id: 2 }), task({ id: 3, due_date: TODAY, priority: 1 })];
    const items = listFor("today", xs, "priority");
    expect(items.map((i) => i.task.id)).toEqual([3, 2, 1]);
    expect(items.map((i) => i.group)).toEqual(["Минимальная", "Сделано", "Отменено"]);
  });

  it("прогресс дня: отменённые не в счёт", () => {
    const xs = [task({ due_date: TODAY }), done(), cancelled()];
    const p = progressFor("today", xs)!;
    expect(p.subtitle).toBe("1 из 2 сделано, отменено 1");
    expect(p.fraction).toBe(0.5);
    expect(p.count).toBe(1);
  });

  it("поиск показывает отменённые отдельной группой", () => {
    const items = searchTasks("отчёт", [cancelled({ title: "Отчёт" })], []);
    expect(items[0].group).toBe("Отменено");
  });

  it("главная: отменённые не считаются ни сделанными, ни встречами", () => {
    const xs = [done(), cancelled(), cancelled({ kind: "meeting", start_time: "10:00", end_time: "11:00" })];
    expect(summary(xs).doneToday).toBe(1);
    expect(meetingStats(xs, "week").count).toBe(0);
  });
});
