import { describe, expect, it } from "vitest";
import { foundIn, marks, searchNames, searchProjects, searchTasks } from "../search";
import { applyFilter, EMPTY_FILTER } from "../tags";
import { task } from "./helpers";

const ids = (xs: { id: number }[]) => xs.map((x) => x.id);
const space = { id: 7, name: "Ремонт", description: "Квартира на Ленина", color: "move", icon: "folder", position: 1 } as never;

describe("поиск задач в фильтрах", () => {
  const tasks = [
    task({ id: 1, title: "Позвонить Ёлкину", status: "inbox" }),
    task({ id: 2, title: "Отчёт", note: "сверить с елкиным цифры", due_date: "2026-10-10" }),
    task({ id: 3, title: "Купить плитку", project_id: 7, status: "archived", done_at: "2026-10-01T10:00:00" }),
    task({ id: 4, title: "Ревью", assigned_by: "Маша", tags: [{ id: 1, name: "работа", color: "move" }] }),
    task({ id: 5, title: "Чеклист", subtasks: [{ id: 1, task_id: 5, title: "купить краску", done: 0, position: 0 }] }),
    task({ id: 6, title: "Встреча", kind: "meeting", participants: ["Олег"] }),
  ];

  it("без регистра и с ё как е, в названии и заметке", () => {
    expect(ids(searchTasks("ЕЛКИН", tasks))).toEqual([1, 2]);
  });

  it("по тегам, по тому, кто назначил, по участникам, по пространству, по чеклисту", () => {
    expect(ids(searchTasks("работа", tasks))).toEqual([4]);
    expect(ids(searchTasks("маша", tasks))).toEqual([4]);
    expect(ids(searchTasks("олег", tasks))).toEqual([6]);
    expect(ids(searchTasks("ремонт", tasks, [space]))).toEqual([3]);
    expect(ids(searchTasks("краск", tasks))).toEqual([5]);
  });

  it("запрос ищется целиком, как набран: без перестановки слов, порядок не меняется", () => {
    expect(ids(searchTasks("купить плитку", tasks))).toEqual([3]);
    expect(ids(searchTasks("купить   плитку ", tasks))).toEqual([3]);
    expect(ids(searchTasks("плитку купить", tasks))).toEqual([]);
    expect(ids(searchTasks("купить", tasks))).toEqual([3, 5]);
  });

  it("никакой нечёткости: «прив» не находит «Проверить», цифра только там, где она есть", () => {
    const xs = [
      task({ id: 1, title: "Привет" }),
      task({ id: 2, title: "Проверить" }),
      task({ id: 3, title: "Заметка 4" }),
      task({ id: 4, title: "Ссылка", links: [{ id: 1, task_id: 4, title: "Док", url: "https://x.com/4a", position: 0 }] }),
    ];
    expect(ids(searchTasks("прив", xs))).toEqual([1]);
    expect(ids(searchTasks("ПРИВ", xs))).toEqual([1]);
    expect(ids(searchTasks("4", xs))).toEqual([3]);
  });

  it("где нашлось: название, заметка, чеклист и остальное", () => {
    expect(foundIn(tasks[0], "ёлкин")).toBe("title");
    expect(foundIn(tasks[1], "елкин")).toBe("note");
    expect(foundIn(tasks[4], "краск")).toBe("checklist");
    expect(foundIn(tasks[3], "маш")).toBe("assignee");
    expect(foundIn(tasks[2], "ремонт", space)).toBe("space");
    expect(foundIn(tasks[2], "дача", space)).toBeNull();
  });

  it("пустой запрос ничего не прячет", () => {
    expect(searchTasks("  ", tasks)).toBe(tasks);
  });

  it("текст складывается с остальным фильтром", () => {
    expect(ids(applyFilter(tasks, { ...EMPTY_FILTER, text: "купить" }, [space]))).toEqual([3, 5]);
    expect(ids(applyFilter(tasks, { ...EMPTY_FILTER, text: "купить", spaces: [7] }, [space]))).toEqual([3]);
  });

  it("подсветка: чередуются обычный и найденный куски", () => {
    expect(marks("Позвонить Ёлкину", "елкин")).toEqual(["Позвонить ", "Ёлкин", "у"]);
    expect(marks("abc", "zz")).toEqual(["abc"]);
  });
});

describe("поиск пространств и людей", () => {
  it("пространства по названию и описанию", () => {
    expect(ids(searchProjects("ленина", [space]))).toEqual([7]);
    expect(ids(searchProjects("дача", [space]))).toEqual([]);
  });
  it("люди по имени без регистра", () => {
    const rows = [{ name: "Андрей Ёлкин", count: 2 }, { name: "Маша", count: 1 }];
    expect(searchNames("елкин", rows).map((r) => r.name)).toEqual(["Андрей Ёлкин"]);
    expect(searchNames("", rows)).toBe(rows);
  });
});
