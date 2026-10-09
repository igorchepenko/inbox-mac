import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri ждёт dev-сервер на фиксированном порту
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "safari15", outDir: "dist" },
});
