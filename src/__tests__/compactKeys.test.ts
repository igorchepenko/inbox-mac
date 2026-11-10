import { describe, expect, it } from "vitest";
import { clampRow, keyAction, stepList, stepRow } from "../compactKeys";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, ...mods }) as KeyboardEvent;

describe("клавиатура в компактном виде", () => {
  it("↑ и ↓ ходят по строкам и не перескакивают через край", () => {
    expect(stepRow(null, 1, 3)).toBe(0);
    expect(stepRow(null, -1, 3)).toBe(2);
    expect(stepRow(0, -1, 3)).toBe(0);
    expect(stepRow(2, 1, 3)).toBe(2);
    expect(stepRow(1, 1, 3)).toBe(2);
    expect(stepRow(0, 1, 0)).toBeNull();
  });

  it("← и → переключают списки по кругу", () => {
    const lists = ["tasks", "inbox", "today"];
    expect(stepList("inbox", 1, lists)).toBe("today");
    expect(stepList("today", 1, lists)).toBe("tasks");
    expect(stepList("tasks", -1, lists)).toBe("today");
    expect(stepList("waiting", 1, lists)).toBe("tasks");
  });

  it("курсор остаётся в пределах списка, когда он укоротился", () => {
    expect(clampRow(5, 3)).toBe(2);
    expect(clampRow(1, 3)).toBe(1);
    expect(clampRow(0, 0)).toBeNull();
    expect(clampRow(null, 3)).toBeNull();
  });

  it("клавиши со стрелками и Enter, сочетания с модификаторами не трогаем", () => {
    expect(keyAction(key("ArrowDown"), false)).toBe("down");
    expect(keyAction(key("ArrowLeft"), false)).toBe("left");
    expect(keyAction(key("Enter"), false)).toBe("enter");
    expect(keyAction(key("Enter", { shiftKey: true }), false)).toBeNull();
    expect(keyAction(key("ArrowDown", { metaKey: true }), false)).toBeNull();
    expect(keyAction(key("a"), false)).toBeNull();
  });

  it("в строке ввода стрелки и Enter остаются ей, ↑ выводит к списку", () => {
    expect(keyAction(key("Enter"), true)).toBeNull();
    expect(keyAction(key("ArrowLeft"), true)).toBeNull();
    expect(keyAction(key("ArrowUp"), true)).toBe("up");
  });
});
