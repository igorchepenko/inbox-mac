import { describe, expect, it } from "vitest";
import { FEEDBACK_URL } from "../feedback";
import { greeting } from "../home/data";

describe("обратная связь и приветствие", () => {
  it("форма открывается по https", () => {
    expect(FEEDBACK_URL).toMatch(/^https:\/\/docs\.google\.com\/forms\//);
  });
  it("приветствие не требует имени", () => {
    expect(greeting(new Date(2026, 0, 1, 19))).toBe("Добрый вечер");
  });
});
