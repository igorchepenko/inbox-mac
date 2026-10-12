import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marks, searchTasks } from "../search";
import { freezeToday, task } from "./helpers";

beforeEach(freezeToday); // сегодня 2026-10-10
afterEach(() => vi.useRealTimers());

const ids = (xs: { task: { id: number } }[]) => xs.map((i) => i.task.id);
const space = { id: 7, name: "Ремонт", description: "", color: "move", icon: "folder", position: 1 } as never;

describe("поиск", () => {
  const tasks = [
    task({ id: 1, title: "Позвонить Ёлкину", status: "inbox" }),
    task({ id: 2, title: "Отчёт", note: "сверить с елкиным цифры", due_date: "2026-10-10" }),
    task({ id: 3, title: "Купить плитку", project_id: 7, status: "archived", done_at: "2026-10-01T10:00:00" }),
    task({ id: 4, title: "Ревью", assigned_by: "Маша", tags: [{ id: 1, name: "работа", color: "move" }] }),
    task({ id: 5, title: "Чеклист", subtasks: [{ id: 1, task_id: 5, title: "купить краску", done: 0, position: 0 }] }),
  ];

  it("без регистра и с ё как е, в названии и заметке", () => {
    expect(ids(searchTasks("ЕЛКИН", tasks, []))).toEqual([1, 2]);
  });

  it("по тегам, по тому, кто назначил, по пространству, по чеклисту", () => {
    expect(ids(searchTasks("работа", tasks, []))).toEqual([4]);
    expect(ids(searchTasks("маша", tasks, []))).toEqual([4]);
    expect(ids(searchTasks("ремонт", tasks, [space]))).toEqual([3]);
    expect(ids(searchTasks("краск", tasks, []))).toEqual([5]);
  });

  it("все слова запроса должны найтись, порядок любой", () => {
    expect(ids(searchTasks("купить плитку", tasks, []))).toEqual([3]);
    expect(ids(searchTasks("плитку купить", tasks, []))).toEqual([3]);
    expect(ids(searchTasks("купить", tasks, []))).toEqual([5, 3]);
  });

  it("группы по месту: Новые, Сегодня, Скоро, Сделано, Архив", () => {
    const r = searchTasks("а", [task({ id: 1, title: "а", status: "archived" }), task({ id: 2, title: "а", status: "inbox" }),
      task({ id: 3, title: "а", due_date: "2026-10-09" }), task({ id: 4, title: "а" })], []);
    expect(r.map((i) => [i.task.id, i.group])).toEqual([[2, "Новые"], [3, "Сегодня"], [4, "Скоро"], [1, "Архив"]]);
  });

  it("совпадение в названии выше совпадения в заметке", () => {
    const r = searchTasks("план", [task({ id: 1, title: "x", note: "план" }), task({ id: 2, title: "План" })], []);
    expect(ids(r)).toEqual([2, 1]);
  });

  it("пустой запрос ничего не находит", () => {
    expect(searchTasks("  ", tasks, [])).toEqual([]);
  });

  it("подсветка: чередуются обычный и найденный куски", () => {
    expect(marks("Позвонить Ёлкину", "елкин")).toEqual(["Позвонить ", "Ёлкин", "у"]);
    expect(marks("abc", "zz")).toEqual(["abc"]);
  });
});
