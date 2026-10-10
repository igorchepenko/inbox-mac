import { afterEach, describe, expect, it, vi } from "vitest";
import { activeProfile, isProfile, profileKey } from "../profile";

describe("профили", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("у «Теста» ключи localStorage прежние: настройки, что были до профилей, остаются в нём", () => {
    expect(profileKey("inbox.theme", "test")).toBe("inbox.theme");
    expect(profileKey("cal:mode", "test")).toBe("cal:mode");
  });

  it("у «Игоря» ключи свои и не пересекаются с «Тестом»", () => {
    expect(profileKey("inbox.theme", "igor")).toBe("igor:inbox.theme");
    expect(profileKey("inbox.panes", "igor")).not.toBe(profileKey("inbox.panes", "test"));
  });

  it("без сохранённого выбора открывается «Тест», где лежат прежние данные", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    expect(activeProfile()).toBe("test");
  });

  it("неизвестное значение и недоступный localStorage тоже дают «Тест»", () => {
    vi.stubGlobal("localStorage", { getItem: () => "admin" });
    expect(activeProfile()).toBe("test");
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(activeProfile()).toBe("test");
  });

  it("сохранённый «Игорь» читается", () => {
    vi.stubGlobal("localStorage", { getItem: () => "igor" });
    expect(activeProfile()).toBe("igor");
    expect(profileKey("inbox.appearance")).toBe("igor:inbox.appearance");
    expect(isProfile("igor")).toBe(true);
    expect(isProfile("Игорь")).toBe(false);
  });
});
