import { describe, expect, it } from "vitest";
import { fmtDate } from "../buildInfo";

describe("дата выпуска", () => {
  it("по-русски: число, месяц в родительном, год", () => {
    expect(fmtDate("2026-10-13")).toBe("13 октября 2026");
    expect(fmtDate("2026-01-05")).toBe("5 января 2026");
  });
  it("неразборчивое значение показывается как есть", () => {
    expect(fmtDate("мусор")).toBe("мусор");
  });
});
