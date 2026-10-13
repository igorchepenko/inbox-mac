import { describe, expect, it } from "vitest";
import { fmtDate, needsWelcome, ONB_BANNER_OFF, ONB_INTRO, ONB_SEEN, ONB_TOUR, showBanner, statusText, tipAt, TOUR_STEPS, union } from "../onb";

describe("первый запуск и онбординг", () => {
  it("первый экран нужен, пока он не показан", () => {
    expect(needsWelcome({})).toBe(true);
    expect(needsWelcome({ [ONB_SEEN]: "1" })).toBe(false);
  });

  it("баннер на дашборде: после первого экрана, пока ничего не пройдено и не скрыто", () => {
    expect(showBanner({})).toBe(false);
    expect(showBanner({ [ONB_SEEN]: "1" })).toBe(true);
    expect(showBanner({ [ONB_SEEN]: "1", [ONB_INTRO]: "2026-10-13" })).toBe(false);
    expect(showBanner({ [ONB_SEEN]: "1", [ONB_TOUR]: "2026-10-13" })).toBe(false);
    expect(showBanner({ [ONB_SEEN]: "1", [ONB_BANNER_OFF]: "1" })).toBe(false);
  });

  it("статус в настройках: дата прохождения по-русски", () => {
    expect(statusText({}, "intro")).toBe("Не пройден");
    expect(statusText({ [ONB_TOUR]: "2026-10-13" }, "tour")).toBe("Пройден 13 октября 2026");
    expect(fmtDate("2026-01-05")).toBe("5 января 2026");
    expect(fmtDate("мусор")).toBe("мусор");
  });

  it("общая рамка группы элементов", () => {
    expect(union([])).toBeNull();
    expect(union([{ left: 10, top: 10, width: 20, height: 20 }, { left: 0, top: 40, width: 50, height: 10 }])).toEqual({ left: 0, top: 10, width: 50, height: 40 });
  });

  const tip = { w: 300, h: 150 }, view = { w: 1000, h: 700 };
  it("подсказка справа от элемента, если там есть место", () => {
    const p = tipAt({ left: 20, top: 100, width: 200, height: 40 }, tip, view);
    expect(p.left).toBe(234);
  });
  it("у правого края подсказка уходит влево, у нижнего остаётся в окне", () => {
    const p = tipAt({ left: 800, top: 650, width: 180, height: 40 }, tip, view);
    expect(p.left).toBe(800 - 14 - 300);
    expect(p.top + tip.h).toBeLessThanOrEqual(700 - 12);
  });
  it("без цели подсказка по центру", () => {
    expect(tipAt(null, tip, view).left).toBe(350);
  });

  it("шаги: у каждого есть название и текст, ожидание только из известных", () => {
    const steps = TOUR_STEPS("⌥Space");
    expect(steps.length).toBe(10);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) {
      expect(s.title && s.text).toBeTruthy();
      if (s.wait) expect(["created", "selected", "done"]).toContain(s.wait);
    }
    expect(steps[0].text).toContain("⌥Space");
  });
});
