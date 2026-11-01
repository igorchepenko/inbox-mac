import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LIST = JSON.stringify([{ id: "test", name: "Тест" }, { id: "igor", name: "Игорь" }, { id: "p1", name: "Работа" }]);

/** Модуль читает список профилей при загрузке, поэтому каждый тест подставляет localStorage до импорта */
async function load(store: Record<string, string> | "blocked") {
  vi.resetModules();
  vi.stubGlobal("localStorage", store === "blocked"
    ? { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }
    : { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v), removeItem: (k: string) => delete store[k] });
  return import("../profile");
}

describe("профили", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("у «test» ключи localStorage прежние: настройки, что были до профилей, остаются в нём", async () => {
    const m = await load({});
    expect(m.profileKey("inbox.theme", "test")).toBe("inbox.theme");
    expect(m.profileKey("cal:mode", "test")).toBe("cal:mode");
  });

  it("у остальных профилей ключи свои и не пересекаются", async () => {
    const m = await load({});
    expect(m.profileKey("inbox.theme", "igor")).toBe("igor:inbox.theme");
    expect(m.profileKey("inbox.theme", "p1")).toBe("p1:inbox.theme");
    expect(m.profileKey("inbox.panes", "p1")).not.toBe(m.profileKey("inbox.panes", "p2"));
  });

  it("без сохранённого выбора открывается первый профиль списка", async () => {
    const m = await load({ "inbox.profile-list": LIST });
    expect(m.activeProfile()).toBe("test");
  });

  it("выбор удалённого профиля и недоступный localStorage дают первый из списка", async () => {
    const m = await load({ "inbox.profile-list": LIST, "inbox.profile": "p7" });
    expect(m.activeProfile()).toBe("test");
    const b = await load("blocked");
    expect(b.activeProfile()).toBe("");
  });

  it("сохранённый профиль читается, имя берётся из списка", async () => {
    const m = await load({ "inbox.profile-list": LIST, "inbox.profile": "p1" });
    expect(m.activeProfile()).toBe("p1");
    expect(m.profileName("p1")).toBe("Работа");
    expect(m.profileKey("inbox.appearance")).toBe("p1:inbox.appearance");
    expect(m.isProfile("igor")).toBe(true);
    expect(m.isProfile("Игорь")).toBe(false);
  });

  it("пока профилей нет, активного нет: приложение предложит создать", async () => {
    const m = await load({});
    expect(m.profiles()).toEqual([]);
    expect(m.activeProfile()).toBe("");
  });
});
