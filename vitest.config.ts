import { defineConfig } from "vitest/config";

// Тесты только на чистую логику (даты, повторы, сортировки, календарь): без браузера и Tauri
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"], env: { TZ: "Europe/Moscow" } },
});
