import { describe, expect, it } from "vitest";
import { dropIndex, edgeScroll, moveItem, neighborShift, pastThreshold } from "../drag";

describe("перетаскивание", () => {
  it("клик не становится перетаскиванием, пока курсор не ушёл за порог", () => {
    expect(pastThreshold(10, 10, 12, 12)).toBe(false);
    expect(pastThreshold(10, 10, 10, 20)).toBe(true);
  });

  it("прокрутка у края идёт в нужную сторону, в середине стоит", () => {
    expect(edgeScroll(5, 0, 100, 20, 8)).toBe(-8);
    expect(edgeScroll(95, 0, 100, 20, 8)).toBe(8);
    expect(edgeScroll(50, 0, 100, 20, 8)).toBe(0);
  });

  it("moveItem не меняет исходный массив и не выходит за границы", () => {
    const src = ["a", "b", "c", "d"];
    expect(moveItem(src, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(src, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(src, 1, 99)).toEqual(["a", "c", "d", "b"]);
    expect(src).toEqual(["a", "b", "c", "d"]);
  });

  it("dropIndex считает место по центрам соседей", () => {
    const tops = [0, 40, 80, 120], heights = [40, 40, 40, 40];
    expect(dropIndex(tops, heights, 0, 0)).toBe(0);
    expect(dropIndex(tops, heights, 0, 90)).toBe(2);
    expect(dropIndex(tops, heights, 3, -200)).toBe(0);
  });

  it("соседи расступаются в сторону, противоположную движению", () => {
    expect(neighborShift(1, 0, 2, 40)).toBe(-40);
    expect(neighborShift(1, 2, 0, 40)).toBe(40);
    expect(neighborShift(3, 0, 2, 40)).toBe(0);
  });
});
