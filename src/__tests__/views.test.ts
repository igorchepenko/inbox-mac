import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareBy, countFor, listFor, plural, sortOf } from "../views";
import { boardFor, stageOf } from "../boardOps";
import { freezeToday, task } from "./helpers";

beforeEach(freezeToday); // сегодня 2026-10-10
afterEach(() => vi.useRealTimers());

const ids = (xs: { task: { id: number } }[]) => xs.map((i) => i.task.id);

describe("сортировка", () => {
  it("по дате: ближайшие сверху, без даты в конце", () => {
    const a = task({ id: 1, due_date: "2026-10-12" });
    const b = task({ id: 2, due_date: null });
    const c = task({ id: 3, due_date: "2026-10-11" });
    expect([a, b, c].sort(compareBy("date")).map((x) => x.id)).toEqual([3, 1, 2]);
  });

  it("в один день: сначала со временем по возрастанию, затем без времени", () => {
    const noTime = task({ id: 1, due_date: "2026-10-11" });
    const late = task({ id: 2, due_date: "2026-10-11", start_time: "15:00" });
    const early = task({ id: 3, due_date: "2026-10-11", start_time: "09:00" });
    const remind = task({ id: 4, due_date: "2026-10-11", remind_at: "2026-10-11T11:00" });
    expect([noTime, late, early, remind].sort(compareBy("date")).map((x) => x.id)).toEqual([3, 4, 2, 1]);
  });

  it("при равной дате важнее выше, при равной важности свежее выше", () => {
    const a = task({ id: 1, due_date: "2026-10-11", priority: 2 });
    const b = task({ id: 2, due_date: "2026-10-11", priority: 5 });
    const c = task({ id: 3, due_date: "2026-10-11", priority: 2, created_at: "2026-10-05T10:00:00" });
    expect([a, b, c].sort(compareBy("date")).map((x) => x.id)).toEqual([2, 3, 1]);
  });

  it("по важности: максимальная сверху, внутри уровня по дате", () => {
    const a = task({ id: 1, priority: 3, due_date: "2026-10-12" });
    const b = task({ id: 2, priority: 5, due_date: "2026-10-20" });
    const c = task({ id: 3, priority: 3, due_date: "2026-10-11" });
    expect([a, b, c].sort(compareBy("priority")).map((x) => x.id)).toEqual([2, 3, 1]);
  });

  it("по матрице: порядок квадрантов 1, 3, 2, 4, без квадранта в конце", () => {
    const q = (id: number, quadrant: number | null) => task({ id, quadrant });
    const sorted = [q(1, null), q(2, 4), q(3, 2), q(4, 3), q(5, 1)].sort(compareBy("matrix"));
    expect(sorted.map((x) => x.id)).toEqual([5, 4, 3, 2, 1]);
  });

  it("sortOf берёт сохранённое значение или по дате", () => {
    expect(sortOf("today", { "sort:today": "matrix" })).toBe("matrix");
    expect(sortOf("today", { "sort:today": "чушь" })).toBe("date");
    expect(sortOf("inbox", {})).toBe("date");
  });
});

describe("списки", () => {
  const tasks = [
    task({ id: 1, status: "inbox" }),
    task({ id: 2, status: "active", due_date: "2026-10-09" }), // просрочена
    task({ id: 3, status: "active", due_date: "2026-10-10" }),
    task({ id: 4, status: "active", due_date: "2026-10-15" }),
    task({ id: 5, status: "active", due_date: null, created_at: "2026-10-03T10:00:00" }),
    task({ id: 6, status: "done", due_date: "2026-10-10", done_at: "2026-10-10T09:00:00" }),
    task({ id: 7, status: "done", due_date: "2026-10-01", done_at: "2026-10-01T09:00:00" }),
    task({ id: 8, status: "archived", done_at: "2026-10-02T09:00:00" }),
    task({ id: 9, status: "active", project_id: 3, created_at: "2026-10-02T10:00:00" }),
  ];

  it("«Сегодня» включает просроченное и сделанное сегодня, открытое выше сделанного", () => {
    expect(ids(listFor("today", tasks))).toEqual([2, 3, 6]);
  });

  it("«Скоро» — будущие даты по дням, потом без даты, с заголовками групп", () => {
    const items = listFor("soon", tasks);
    expect(ids(items)).toEqual([4, 5, 9]); // у 5 и 9 нет даты: свежая выше
    expect(items.map((i) => i.group)).toEqual(["Чт, 15 окт", "Без даты", undefined]);
  });

  it("«Новые» — только неразобранные", () => {
    expect(ids(listFor("inbox", tasks))).toEqual([1]);
  });

  it("архив: свежее сверху, сделанное вчера не попадает в «Сегодня»", () => {
    expect(ids(listFor("archive", tasks))).toEqual([8]);
    expect(ids(listFor("today", tasks))).not.toContain(7);
  });

  it("список пространства показывает его активные задачи", () => {
    expect(ids(listFor("p:3", tasks))).toEqual([9]);
  });

  it("при сортировке по важности появляются заголовки групп", () => {
    const xs = [task({ id: 1, status: "inbox", priority: 5 }), task({ id: 2, status: "inbox", priority: 5 }), task({ id: 3, status: "inbox", priority: 1 })];
    expect(listFor("inbox", xs, "priority").map((i) => i.group)).toEqual(["Максимальная", undefined, "Минимальная"]);
  });

  it("счётчик не учитывает сделанные", () => {
    expect(countFor("today", tasks)).toBe(2);
  });
});

describe("plural", () => {
  it("русские числительные", () => {
    expect(plural(1, "задача", "задачи", "задач")).toBe("1 задача");
    expect(plural(3, "задача", "задачи", "задач")).toBe("3 задачи");
    expect(plural(5, "задача", "задачи", "задач")).toBe("5 задач");
    expect(plural(11, "задача", "задачи", "задач")).toBe("11 задач");
    expect(plural(21, "задача", "задачи", "задач")).toBe("21 задача");
  });
});

describe("канбан", () => {
  it("этап определяется статусом", () => {
    expect(stageOf(task({ status: "inbox" }))).toBe("new");
    expect(stageOf(task({ status: "active" }))).toBe("todo");
    expect(stageOf(task({ status: "done" }))).toBe("done");
  });

  it("«Готово» показывает только сделанное за неделю, новые сделанные сверху", () => {
    const xs = [
      task({ id: 1, status: "done", done_at: "2026-10-08T10:00:00" }),
      task({ id: 2, status: "done", done_at: "2026-10-09T10:00:00" }),
      task({ id: 3, status: "done", done_at: "2026-09-20T10:00:00" }),
      task({ id: 4, status: "active" }),
    ];
    const cols = boardFor("today", xs, "date");
    expect(cols.map((c) => c.key)).toEqual(["new", "todo", "done"]);
    expect(ids(cols[2].items)).toEqual([2, 1]);
    expect(ids(cols[1].items)).toEqual([4]);
  });

  it("в пространстве канбан берёт только его задачи", () => {
    const xs = [task({ id: 1, project_id: 3 }), task({ id: 2, project_id: 4 })];
    expect(ids(boardFor("p:3", xs, "date")[1].items)).toEqual([1]);
  });
});
