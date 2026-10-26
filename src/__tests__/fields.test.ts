import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fieldsChanged, fieldsFor, fullDay, hiddenFields, shownFields, tips, toggleField } from "../fields";
import { freezeToday, task } from "./helpers";

beforeEach(freezeToday); // сегодня суббота, 2026-10-10
afterEach(() => vi.useRealTimers());

describe("поля задач в списке и на канбане", () => {
  it("без настройки скрыты только участники", () => {
    expect(hiddenFields({}, "list")).toEqual(["participants"]);
    const show = shownFields({}, "board");
    expect(show("tags")).toBe(true);
    expect(show("participants")).toBe(false);
    expect(fieldsChanged({}, "list")).toBe(false);
  });

  it("список и канбан настраиваются отдельно", () => {
    const s = { "fields:list": toggleField({}, "list", "tags", false) };
    expect(shownFields(s, "list")("tags")).toBe(false);
    expect(shownFields(s, "board")("tags")).toBe(true);
    expect(fieldsChanged(s, "list")).toBe(true);
  });

  it("включение возвращает поле, порядок ключа стабилен", () => {
    let s: Record<string, string> = {};
    s = { "fields:list": toggleField(s, "list", "created", false) };
    s = { "fields:list": toggleField(s, "list", "participants", true) };
    s = { "fields:list": toggleField(s, "list", "tags", false) };
    expect(JSON.parse(s["fields:list"])).toEqual(["tags", "created"]);
    s = { "fields:list": toggleField(s, "list", "created", true) };
    expect(hiddenFields(s, "list")).toEqual(["tags"]);
  });

  it("мусор в настройке не ломает вид", () => {
    expect(hiddenFields({ "fields:list": "{oops" }, "list")).toEqual(["participants"]);
    expect(hiddenFields({ "fields:list": '["nope","tags"]' }, "list")).toEqual(["tags"]);
  });

  it("этапа на канбане нет: он виден по столбцу", () => {
    expect(fieldsFor("board").some((f) => f.id === "stage")).toBe(false);
    expect(fieldsFor("list").some((f) => f.id === "stage")).toBe(true);
  });
});

describe("подсказки при наведении", () => {
  it("дата полностью, со словом для близких дней", () => {
    expect(fullDay("2026-10-10")).toBe("Сегодня, суббота, 10 октября 2026");
    expect(fullDay("2026-10-16")).toBe("Пятница, 16 октября 2026");
    expect(tips.date(task({ due_date: "2026-10-09" }), true)).toBe("Дата: Вчера, пятница, 9 октября 2026. Просрочена");
  });

  it("чеклист перечисляет пункты с отметками", () => {
    const x = task({ subtasks: [
      { id: 1, task_id: 1, title: "Позвонить", done: 1, position: 0 },
      { id: 2, task_id: 1, title: "Написать", done: 0, position: 1 },
    ] });
    expect(tips.checklist(x)).toBe("Чеклист: выполнено 1 из 2\n✓ Позвонить\n○ Написать");
  });

  it("длинный перечень обрезается", () => {
    const names = Array.from({ length: 11 }, (_, i) => `Человек ${i + 1}`);
    const t = tips.participants(names).split("\n");
    expect(t[0]).toBe("Участники: 11");
    expect(t).toHaveLength(10);
    expect(t[t.length - 1]).toBe("и ещё 3");
  });

  it("срок, важность, матрица, повтор", () => {
    expect(tips.due(task({ due_date: "2026-10-10", end_time: "18:00" }))).toBe("Срок: сегодня до 18:00. Скоро");
    expect(tips.priority(4)).toBe("Важность: высокая");
    expect(tips.matrix(1)).toBe("Матрица: срочно, важно, сделать сейчас");
    expect(tips.repeat(task({ recurrence: JSON.stringify({ freq: "day", every: 1 }) }))).toBe("Повтор: каждый день");
  });
});
