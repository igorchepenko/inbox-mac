import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTagName, applyFilter, canonicalPerson, firstTag, normalizeTag, NO_PERSON, parseQuick, peopleOf, pickColor, suggest, TAG_COLORS,
} from "../tags";
import { compareBy, countFor, listFor, NO_PERSON_GROUP, NO_TAG_GROUP } from "../views";
import { boardFor } from "../boardOps";
import type { Tag } from "../db";
import { freezeToday, task } from "./helpers";

beforeEach(freezeToday); // сегодня 2026-10-10
afterEach(() => vi.useRealTimers());

const work: Tag = { id: 1, name: "работа", color: "scarlet" };
const call: Tag = { id: 2, name: "Созвон", color: "teal" };
const home: Tag = { id: 3, name: "дом", color: "royal" };
const ids = (xs: { task: { id: number } }[]) => xs.map((i) => i.task.id);

describe("название тега", () => {
  it("без # и лишних пробелов, не длиннее 16 символов", () => {
    expect(normalizeTag("  #работа  ")).toBe("работа");
    expect(normalizeTag("очень   важное")).toBe("очень важное");
    expect(normalizeTag("абвгдеёжзийклмнопрст")).toHaveLength(16);
    expect(normalizeTag("   ")).toBe("");
  });

  it("не больше шести и без повторов с другим регистром", () => {
    let names: string[] = [];
    for (const n of ["Работа", "работа", "дом", "", "a", "b", "c", "d", "e"]) names = addTagName(names, n);
    expect(names).toEqual(["Работа", "дом", "a", "b", "c", "d"]);
  });
});

describe("цвет нового тега", () => {
  it("в палитре 24 разных цвета", () => {
    expect(TAG_COLORS).toHaveLength(24);
    expect(new Set(TAG_COLORS).size).toBe(24);
  });

  it("первый тег берёт первый цвет, второй самый далёкий от него по кругу", () => {
    expect(pickColor([])).toBe(TAG_COLORS[0]);
    expect(pickColor([TAG_COLORS[0]])).toBe(TAG_COLORS[12]);
  });

  it("третий встаёт посередине между занятыми", () => {
    expect([6, 18]).toContain(TAG_COLORS.indexOf(pickColor([TAG_COLORS[0], TAG_COLORS[12]])));
  });

  it("пока есть свободные цвета, повторов нет", () => {
    const used: string[] = [];
    for (let i = 0; i < 24; i++) used.push(pickColor(used));
    expect(new Set(used).size).toBe(24);
  });

  it("когда заняты все, начинается второй круг", () => {
    expect(pickColor([...TAG_COLORS])).toBe(TAG_COLORS[0]);
    expect(pickColor([...TAG_COLORS, TAG_COLORS[0]])).toBe(TAG_COLORS[12]);
  });
});

describe("быстрый ввод в названии", () => {
  it("#тег и @Имя уходят из текста", () => {
    expect(parseQuick("Выгрузить транскрибацию #созвон @Андрей")).toEqual({ title: "Выгрузить транскрибацию", tags: ["созвон"], person: "Андрей" });
  });

  it("номер вроде #123 и почта остаются в тексте", () => {
    expect(parseQuick("Закрыть тикет #123, написать ivan@mail.ru")).toEqual({ title: "Закрыть тикет #123, написать ivan@mail.ru", tags: [], person: null });
  });

  it("несколько тегов в любом месте, повторы и седьмой отбрасываются", () => {
    const q = parseQuick("#a #b задача #c #A #d #e #f #g");
    expect(q.title).toBe("задача");
    expect(q.tags).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("берётся только первое имя", () => {
    expect(parseQuick("@Андрей @Маша созвон").person).toBe("Андрей");
  });
});

describe("кто назначил", () => {
  it("имя пишется так, как уже писали раньше", () => {
    expect(canonicalPerson(" андрей ", ["Андрей", "Маша"])).toBe("Андрей");
    expect(canonicalPerson("Петя", ["Андрей"])).toBe("Петя");
    expect(canonicalPerson("  ", ["Андрей"])).toBeNull();
  });

  it("список людей по алфавиту без повторов", () => {
    const xs = [task({ assigned_by: "Маша" }), task({ assigned_by: "андрей" }), task({ assigned_by: "Андрей" }), task()];
    expect(peopleOf(xs)).toEqual(["андрей", "Маша"]);
  });
});

describe("подсказки", () => {
  it("сначала начинающиеся с набранного, выбранные не предлагаются", () => {
    expect(suggest(["созвон", "рассылка", "сайт", "работа"], "с", ["сайт"])).toEqual(["созвон", "рассылка"]);
    expect(suggest(["a", "b"], "")).toEqual(["a", "b"]);
  });
});

describe("фильтр", () => {
  const a = task({ id: 1, tags: [work], assigned_by: "Андрей" });
  const b = task({ id: 2, tags: [call, home] });
  const c = task({ id: 3, assigned_by: "Маша" });
  const all = [a, b, c];
  const fid = (f: Parameters<typeof applyFilter>[1]) => applyFilter(all, f).map((x) => x.id);

  it("пустой фильтр показывает всё", () => expect(fid({ spaces: [], tags: [], person: null, text: "" })).toEqual([1, 2, 3]));
  it("теги: задачи с любым из выбранных", () => expect(fid({ spaces: [], tags: [1, 3], person: null, text: "" })).toEqual([1, 2]));
  it("человек без учёта регистра", () => expect(fid({ spaces: [], tags: [], person: "андрей", text: "" })).toEqual([1]));
  it("«Сам себе»: без назначившего", () => expect(fid({ spaces: [], tags: [], person: NO_PERSON, text: "" })).toEqual([2]));
  it("«Жду от»: открытые задачи, где ждут этого человека", () => {
    const w = [task({ id: 1, waiting_for: "Андрей" }), task({ id: 2, waiting_for: "Андрей", status: "done" }), task({ id: 3, waiting_for: "Маша" }), task({ id: 4 })];
    expect(applyFilter(w, { spaces: [], tags: [], person: null, waiting: "андрей", text: "" }).map((x) => x.id)).toEqual([1]);
  });
  it("тег и человек вместе", () => {
    expect(fid({ spaces: [], tags: [1, 2], person: "Андрей", text: "" })).toEqual([1]);
    expect(fid({ spaces: [], tags: [2], person: "Маша", text: "" })).toEqual([]);
  });
});

describe("сортировка по тегам и по тому, кто назначил", () => {
  it("по первому по алфавиту тегу, без тегов в конце", () => {
    const x1 = task({ id: 1, tags: [work], due_date: "2026-10-12" });
    const x2 = task({ id: 2 });
    const x3 = task({ id: 3, tags: [call, work], due_date: "2026-10-11" }); // первый по алфавиту «работа», а не «Созвон»
    const x4 = task({ id: 4, tags: [home] });
    expect(firstTag(x3)).toBe("работа");
    expect([x1, x2, x3, x4].sort(compareBy("tag")).map((x) => x.id)).toEqual([4, 3, 1, 2]);
  });

  it("внутри одного тега по дате", () => {
    const x1 = task({ id: 1, tags: [work], due_date: "2026-10-15" });
    const x2 = task({ id: 2, tags: [work], due_date: "2026-10-11" });
    expect([x1, x2].sort(compareBy("tag")).map((x) => x.id)).toEqual([2, 1]);
  });

  it("по имени назначившего, свои в конце", () => {
    const x1 = task({ id: 1, assigned_by: "Маша" });
    const x2 = task({ id: 2 });
    const x3 = task({ id: 3, assigned_by: "Андрей" });
    expect([x1, x2, x3].sort(compareBy("assignee")).map((x) => x.id)).toEqual([3, 1, 2]);
  });

  it("в списке заголовки групп: тег, «Без тегов», сделанные внизу", () => {
    const xs = [task({ id: 1, tags: [work] }), task({ id: 2 }), task({ id: 3, tags: [call] }), task({ id: 4, tags: [work], status: "done", done_at: "2026-10-10T09:00:00", due_date: "2026-10-10" })];
    const items = listFor("today", xs.map((x) => ({ ...x, due_date: "2026-10-10" })), "tag");
    expect(items.map((i) => [i.task.id, i.group])).toEqual([[1, "работа"], [3, "Созвон"], [2, NO_TAG_GROUP], [4, "Сделано"]]);
  });

  it("в списке группы по людям", () => {
    const xs = [task({ id: 1, assigned_by: "Маша" }), task({ id: 2 }), task({ id: 3, assigned_by: "Андрей" })];
    expect(listFor("soon", xs, "assignee").map((i) => i.group)).toEqual(["Андрей", "Маша", NO_PERSON_GROUP]);
  });
});

describe("список тега", () => {
  const xs = [
    task({ id: 1, tags: [work], status: "inbox" }),
    task({ id: 2, tags: [work] }),
    task({ id: 3, tags: [work], status: "done", done_at: "2026-10-10T09:00:00" }),
    task({ id: 4, tags: [work], status: "done", done_at: "2026-10-08T09:00:00" }),
    task({ id: 5, tags: [work], status: "archived" }),
    task({ id: 6, tags: [call] }),
  ];

  it("все задачи тега в работе, включая неразобранные, и сделанные сегодня", () => {
    expect(ids(listFor("t:1", xs)).sort()).toEqual([1, 2, 3]);
  });

  it("в меню считаются только несделанные", () => expect(countFor("t:1", xs)).toBe(2));

  it("канбан тега показывает только его задачи", () => {
    const cols = boardFor("t:1", xs, "date");
    expect(cols.flatMap((c) => ids(c.items)).sort()).toEqual([1, 2, 3, 4]);
  });
});
