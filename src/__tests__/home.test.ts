import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blockOrder, meetingStats } from "../home/data";
import { freezeToday, task } from "./helpers";

beforeEach(freezeToday); // суббота 2026-10-10, неделя 5–11 октября
afterEach(() => vi.useRealTimers());

const meet = (p = {}) => task({ kind: "meeting", ...p });

describe("статистика встреч", () => {
  it("считает встречи недели и месяца, обычные задачи не трогает", () => {
    const tasks = [
      meet({ due_date: "2026-10-06", start_time: "10:00", end_time: "11:30", assigned_by: "Анна" }),
      meet({ due_date: "2026-10-08", start_time: "15:00", end_time: "15:30", assigned_by: "анна", status: "done" }),
      meet({ due_date: "2026-10-01", start_time: "12:00", end_time: "13:00", assigned_by: "Борис" }),
      meet({ due_date: "2026-09-30", start_time: "12:00", end_time: "13:00" }),
      task({ due_date: "2026-10-07", start_time: "12:00", end_time: "13:00" }),
      meet({ due_date: "2026-10-09", status: "inbox" }),
    ];
    const w = meetingStats(tasks, "week");
    expect(w.count).toBe(2);
    expect(w.done).toBe(1);
    expect(w.minutes).toBe(120);
    expect(w.people).toEqual([{ name: "Анна", count: 2, minutes: 120 }]);
    const m = meetingStats(tasks, "month");
    expect(m.count).toBe(3);
    expect(m.minutes).toBe(180);
    expect(m.people.map((p) => p.name)).toEqual(["Анна", "Борис"]);
  });

  it("участники входят в «с кем», автор-участник не считается дважды", () => {
    const s = meetingStats([
      meet({ due_date: "2026-10-06", start_time: "10:00", end_time: "11:00", assigned_by: "Анна", participants: ["Борис", "анна"] }),
      meet({ due_date: "2026-10-07", start_time: "10:00", end_time: "10:30", participants: ["Борис"] }),
    ], "week");
    expect(s.people).toEqual([{ name: "Борис", count: 2, minutes: 90 }, { name: "Анна", count: 1, minutes: 60 }]);
  });

  it("встреча без времени и без автора считается, но в часы не входит", () => {
    const s = meetingStats([meet({ due_date: "2026-10-07" })], "week");
    expect(s).toMatchObject({ count: 1, minutes: 0, untimed: 1, people: [] });
  });
});

describe("порядок блоков главной", () => {
  it("новый блок встреч встаёт в конец сохранённого порядка", () => {
    const saved = JSON.stringify(["projects", "summary"]);
    const order = blockOrder({ "home:order": saved });
    expect(order.slice(0, 2)).toEqual(["projects", "summary"]);
    expect(order).toContain("meetings");
    expect(order[order.length - 1]).toBe("meetings");
  });
});
