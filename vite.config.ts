import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

// Tauri ждёт dev-сервер на фиксированном порту
export default defineConfig({
  plugins: [react()],
  // Версия из package.json и дата сборки показываются в Настройках → О приложении
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "safari15", outDir: "dist" },
});
