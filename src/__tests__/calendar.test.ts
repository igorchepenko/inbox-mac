import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { byDayOrder, itemsFor, layoutDay, movable, rangeFor, shiftAnchor, snap, titleFor, type Item } from "../calendar";
import { freezeToday, task } from "./helpers";

beforeEach(freezeToday);
afterEach(() => vi.useRealTimers());

const timed = (id: number, start: string, end?: string) =>
  itemsFor([task({ id, due_date: "2026-10-12", start_time: start, end_time: end ?? null })], ["2026-10-12"])[0];
const placed = (...its: Item[]) => Object.fromEntries(layoutDay(its).map((p) => [p.task.id, p]));

describe("диапазоны и заголовки", () => {
  it("неделя — семь дней с понедельника, месяц — 42 дня с понедельника", () => {
    const week = rangeFor("week", "2026-10-10");
    expect([week[0], week[6]]).toEqual(["2026-10-05", "2026-10-11"]);
    const month = rangeFor("month", "2026-10-10");
    expect(month).toHaveLength(42);
    expect(month[0]).toBe("2026-09-28");
  });

  it("стрелки листают на день, неделю и месяц", () => {
    expect(shiftAnchor("day", "2026-10-10", 1)).toBe("2026-10-11");
    expect(shiftAnchor("week", "2026-10-10", -1)).toBe("2026-10-03");
    expect(shiftAnchor("month", "2026-12-20", 1)).toBe("2027-01-01");
  });

  it("заголовок недели на стыке месяцев", () => {
    expect(titleFor("week", "2026-10-10")).toBe("5 – 11 октября");
    expect(titleFor("week", "2026-10-29")).toBe("26 октября – 1 ноября");
    expect(titleFor("month", "2026-10-10")).toBe("Октябрь 2026");
  });

  it("snap округляет до 15 минут", () => {
    expect(snap(547)).toBe(540);
    expect(snap(553)).toBe(555);
  });
});

describe("задачи в днях", () => {
  it("задача без конца получает 30 минут, без времени — на весь день", () => {
    const [a] = itemsFor([task({ due_date: "2026-10-12", start_time: "09:00" })], ["2026-10-12"]);
    expect([a.start, a.end]).toEqual([540, 570]);
    const [b] = itemsFor([task({ due_date: "2026-10-12" })], ["2026-10-12"]);
    expect([b.start, b.end]).toEqual([null, null]);
  });

  it("задачи вне видимых дней не попадают", () => {
    expect(itemsFor([task({ due_date: "2026-10-20" })], ["2026-10-12"])).toHaveLength(0);
    expect(itemsFor([task({ due_date: null })], ["2026-10-12"])).toHaveLength(0);
  });

  it("открытая повторяющаяся задача проецируется на будущие дни, но не сама в базу", () => {
    const rec = task({ id: 1, due_date: "2026-10-12", recurrence: '{"freq":"day","every":1}' });
    const items = itemsFor([rec], rangeFor("week", "2026-10-12"));
    expect(items.map((i) => [i.day, i.virtual])).toEqual([
      ["2026-10-12", false], ["2026-10-13", true], ["2026-10-14", true], ["2026-10-15", true], ["2026-10-16", true], ["2026-10-17", true], ["2026-10-18", true],
    ]);
    expect(items.filter((i) => i.virtual).every((i) => !movable(i))).toBe(true);
    expect(movable(items[0])).toBe(true);
  });

  it("сделанная повторяющаяся задача не размножается", () => {
    const done = task({ due_date: "2026-10-12", status: "done", recurrence: '{"freq":"day","every":1}' });
    expect(itemsFor([done], rangeFor("week", "2026-10-12"))).toHaveLength(1);
  });

  it("плашки в ячейке: открытые раньше сделанных, затем по времени", () => {
    const [open] = itemsFor([task({ id: 1, due_date: "2026-10-12", start_time: "18:00" })], ["2026-10-12"]);
    const [done] = itemsFor([task({ id: 2, due_date: "2026-10-12", start_time: "08:00", status: "done" })], ["2026-10-12"]);
    expect([done, open].sort(byDayOrder).map((i) => i.task.id)).toEqual([1, 2]);
  });
});

describe("раскладка пересекающихся задач", () => {
  it("непересекающиеся занимают всю ширину", () => {
    const p = placed(timed(1, "09:00", "10:00"), timed(2, "11:00", "12:00"));
    expect([p[1].left, p[1].width, p[2].left, p[2].width]).toEqual([0, 1, 0, 1]);
  });

  it("начавшиеся почти одновременно делят ширину поровну", () => {
    const p = placed(timed(1, "09:00", "10:00"), timed(2, "09:15", "10:00"));
    expect(p[1].width).toBeCloseTo(0.5);
    expect(p[2].left).toBeCloseTo(0.5);
    expect(p[2].width).toBeCloseTo(0.5);
  });

  it("тройка одновременных делится на трети", () => {
    const p = placed(timed(1, "09:00", "10:00"), timed(2, "09:00", "10:00"), timed(3, "09:10", "10:00"));
    expect(Object.values(p).map((x) => x.width.toFixed(2))).toEqual(["0.33", "0.33", "0.33"]);
  });

  it("поздняя ложится поверх ранней со сдвигом и тянется до края", () => {
    const p = placed(timed(1, "09:00", "12:00"), timed(2, "10:00", "11:00"));
    expect(p[1].left).toBe(0);
    expect(p[2].left).toBeCloseTo(0.4);
    expect(p[2].left + p[2].width).toBeCloseTo(1);
    expect(p[2].z).toBeGreaterThan(p[1].z);
  });

  it("сдвиг не уходит дальше 75% ширины", () => {
    const its = [0, 1, 2, 3, 4, 5].map((i) => timed(i + 1, `${9 + i}:00`, "20:00"));
    for (const x of layoutDay(its)) expect(x.left).toBeLessThanOrEqual(0.75);
  });

  it("задачи без времени в раскладке не участвуют", () => {
    const [free] = itemsFor([task({ due_date: "2026-10-12" })], ["2026-10-12"]);
    expect(layoutDay([free])).toHaveLength(0);
  });
});
