import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { profileKey } from "./profile";

export type Theme = "system" | "light" | "dark";
const KEY = "inbox.theme";

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(profileKey(KEY));
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
    localStorage.setItem(profileKey(KEY), t);
  } catch {
    // без localStorage тема просто не переживёт перезапуск
  }
  applyTheme(t);
  window.dispatchEvent(new CustomEvent<Theme>("inbox-theme", { detail: t }));
  emit("theme-changed", t).catch(() => {});
}

export function followThemeChanges() {
  listen<Theme>("theme-changed", (e) => applyTheme(e.payload)).catch(() => {});
}

/** Стиль оформления поверх светлой или тёмной темы: плоский (по умолчанию) или «Стекло» */
export type Look = "flat" | "glass";
const LOOK_KEY = "inbox.look";

export function savedLook(): Look {
  try {
    return localStorage.getItem(profileKey(LOOK_KEY)) === "glass" ? "glass" : "flat";
  } catch {
    return "flat";
  }
}

export function applyLook(l: Look) {
  if (l === "glass") document.documentElement.setAttribute("data-look", "glass");
  else document.documentElement.removeAttribute("data-look");
}

export function setLook(l: Look) {
  try {
    localStorage.setItem(profileKey(LOOK_KEY), l);
  } catch {
    // без localStorage стиль не переживёт перезапуск
  }
  applyLook(l);
  window.dispatchEvent(new CustomEvent<Look>("inbox-look", { detail: l }));
  emit("look-changed", l).catch(() => {});
}

export function followLookChanges() {
  listen<Look>("look-changed", (e) => applyLook(e.payload)).catch(() => {});
}
