import { describe, expect, it } from "vitest";
import { nextSpaceColor, PALETTE } from "../palette";

describe("nextSpaceColor", () => {
  it("берёт первый цвет палитры, которого нет у других пространств", () => {
    expect(nextSpaceColor([])).toBe(PALETTE[0].id);
    expect(nextSpaceColor([PALETTE[0].id, PALETTE[2].id])).toBe(PALETTE[1].id);
  });
  it("когда заняты все, идёт по кругу", () => {
    const all = PALETTE.map((s) => s.id);
    expect(nextSpaceColor(all)).toBe(PALETTE[0].id);
    expect(all).toContain(nextSpaceColor([...all, ...all.slice(0, 3)]));
  });
});
