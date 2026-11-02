import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followTask, type Where } from "../follow";
import { EMPTY_FILTER } from "../tags";
import { freezeToday, task, TODAY } from "./helpers";

beforeEach(freezeToday);
afterEach(() => vi.useRealTimers());

const at = (view: Where["view"], p: Partial<Where> = {}): Where => ({ view, multi: [], filter: EMPTY_FILTER, board: false, ...p });
const tag = (id: number, name: string) => ({ id, name, color: "sky", position: 0 }) as never;
const go = (w: Where, x: ReturnType<typeof task>, others = []) => followTask(w, [x, ...others], x.id);

describe("задача остаётся выбранной после правки", () => {
  it("остаётся на месте, если и так видна", () => {
    expect(go(at("p:1"), task({ id: 1, project_id: 1 }))).toBeNull();
    expect(go(at("tasks"), task({ id: 1, priority: 3 }))).toBeNull();
  });
  it("1: пространство А → Б", () => {
    expect(go(at("p:1"), task({ id: 1, project_id: 2 }))?.view).toBe("p:2");
  });
  it("2: фильтр по пространствам дополняется", () => {
    const w = go(at("tasks", { filter: { ...EMPTY_FILTER, spaces: [1] } }), task({ id: 1, project_id: 2 }));
    expect(w?.view).toBe("tasks");
    expect(w?.filter.spaces).toEqual([1, 2]);
  });
  it("3: пространство убрано → все задачи", () => {
    expect(go(at("p:1"), task({ id: 1, project_id: null }))?.view).toBe("tasks");
  });
  it("4 и 5: тег снят → оставшийся тег, иначе все задачи", () => {
    expect(go(at("t:1"), task({ id: 1, tags: [tag(3, "б"), tag(2, "а")] }))?.view).toBe("t:2");
    expect(go(at("t:1"), task({ id: 1, tags: [] }))?.view).toBe("tasks");
  });
  it("6: фильтр по тегу подстраивается", () => {
    const f = { ...EMPTY_FILTER, tags: [1] };
    expect(go(at("tasks", { filter: f }), task({ id: 1, tags: [tag(2, "а")] }))?.filter.tags).toEqual([1, 2]);
    expect(go(at("tasks", { filter: f }), task({ id: 1, tags: [] }))?.filter.tags).toEqual([]);
  });
  it("7: в «Новые»", () => {
    expect(go(at("today"), task({ id: 1, status: "inbox", due_date: TODAY }))?.view).toBe("inbox");
  });
  it("8: из «Новых» туда, где лежит", () => {
    expect(go(at("inbox"), task({ id: 1, due_date: TODAY }))?.view).toBe("today");
    expect(go(at("inbox"), task({ id: 1 }))?.view).toBe("soon");
    expect(go(at("inbox"), task({ id: 1, waiting_for: "Петя" }))?.view).toBe("waiting");
  });
  it("9: сделанная уходит в «Завершённые» откуда бы ни отметили", () => {
    const done = { status: "done" as const, done_at: `${TODAY}T11:00:00` };
    expect(go(at("soon"), task({ id: 1, ...done }))?.view).toBe("archive");
    expect(go(at("tasks"), task({ id: 1, ...done }))?.view).toBe("archive");
    expect(go(at("p:1"), task({ id: 1, project_id: 1, ...done }))?.view).toBe("archive");
  });
  it("10 и 11: из архива и в архив", () => {
    expect(go(at("archive"), task({ id: 1, due_date: TODAY }))?.view).toBe("today");
    expect(go(at("today"), task({ id: 1, status: "archived", done_at: "2026-10-01T10:00:00" }))?.view).toBe("archive");
  });
  it("12 и 13: срок переносит между «Сегодня» и «Скоро»", () => {
    expect(go(at("soon"), task({ id: 1, due_date: TODAY }))?.view).toBe("today");
    expect(go(at("today"), task({ id: 1, due_date: "2026-10-20" }))?.view).toBe("soon");
    expect(go(at("today"), task({ id: 1, due_date: null }))?.view).toBe("soon");
  });
  it("14 и 15: «Жду»", () => {
    expect(go(at("soon"), task({ id: 1, waiting_for: "Петя" }))?.view).toBe("waiting");
    expect(go(at("waiting"), task({ id: 1, due_date: null }))?.view).toBe("soon");
  });
  it("16 и 17: фильтр по человеку переключается", () => {
    expect(go(at("tasks", { filter: { ...EMPTY_FILTER, person: "Петя" } }), task({ id: 1, assigned_by: "Вася" }))?.filter.person).toBe("Вася");
    const w = at("tasks", { filter: { ...EMPTY_FILTER, waiting: "Петя" } });
    expect(go(w, task({ id: 1, waiting_for: "Вася" }))?.filter.waiting).toBe("Вася");
  });
  it("18: не подошла под поиск — не уводим", () => {
    expect(go(at("tasks", { filter: { ...EMPTY_FILTER, text: "нет такого" } }), task({ id: 1 }))).toBeNull();
  });
  it("канбан: смена этапа остаётся в том же виде", () => {
    expect(go(at("tasks", { board: true }), task({ id: 1, status: "inbox" }))).toBeNull();
  });
  it("календарь и главная не трогаем", () => {
    expect(go(at("calendar"), task({ id: 1, status: "archived" }))).toBeNull();
  });
});
