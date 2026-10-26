/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import src from "../widgets.tsx?raw";

// Тесты без браузера, поэтому проверяем сам исходник. Баг: у панели со стеклом (backdrop-filter) position: fixed
// считается от панели, и выбор повтора в панели задачи уезжал за экран. Всплывашка обязана жить в body
describe("Popover", () => {
  it("выводится через портал в body, а не внутри панели", () => {
    const popover = src.slice(src.indexOf("export function Popover"), src.indexOf("export function Calendar"));
    expect(popover).toContain("createPortal(");
    expect(popover).toContain("document.body");
  });
});
