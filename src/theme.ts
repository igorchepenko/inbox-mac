import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type Theme = "system" | "light" | "dark";
const KEY = "inbox.theme";

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** Ставит тему в этом окне: CSS-переменные через data-theme и системное оформление окна (заголовок, поля ввода) */
export function applyTheme(t: Theme) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  getCurrentWindow().setTheme(t === "system" ? null : t).catch(() => {});
}

/** Выбор пользователя: запомнить и разослать второму окну */
export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // без localStorage тема просто не переживёт перезапуск
  }
  applyTheme(t);
  emit("theme-changed", t).catch(() => {});
}

export function followThemeChanges() {
  listen<Theme>("theme-changed", (e) => applyTheme(e.payload)).catch(() => {});
}
