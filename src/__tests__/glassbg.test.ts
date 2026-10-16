import { describe, expect, it } from "vitest";
import { blurPx, DEFAULT_GLASS, opacityK, parseGlass, tintAccent } from "../glassbg";

describe("фон стекла", () => {
  it("мусор и пустое значение дают настройки по умолчанию", () => {
    expect(parseGlass(null)).toEqual(DEFAULT_GLASS);
    expect(parseGlass("не json")).toEqual(DEFAULT_GLASS);
  });
  it("битый цвет и выход за пределы ползунков исправляются", () => {
    const g = parseGlass(JSON.stringify({ mode: "solid", light: "red", dark: "#112233", blur: 500, opacity: -4, tint: true }));
    expect(g).toEqual({ mode: "solid", light: DEFAULT_GLASS.light, dark: "#112233", blur: 100, opacity: 0, tint: true });
  });
  it("середина ползунков — как было до настройки", () => {
    expect(blurPx(50)).toBe(30);
    expect(opacityK(50)).toBe(1);
  });
  it("акцент в тон: оттенок берётся из цвета, у тёмной темы светлее", () => {
    expect(tintAccent("#0000FF", false)).toBe("hsl(240 60% 36%)");
    expect(tintAccent("#0000FF", true)).toBe("hsl(240 65% 66%)");
  });
});
