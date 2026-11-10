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

/*
 * Тема «как в системе» в окнах у края экрана (значок и компактный вид). Это панели, которые не активируют Inbox,
 * и macOS отдаёт им светлое оформление даже при тёмной системе. Поэтому главное окно сообщает, какая тема у него
 * на самом деле получилась, а эти окна ставят её себе явно
 */
const EFFECTIVE = "inbox.effective-theme";
type Shade = "light" | "dark";
let borrowSystem = false;
let current: Theme = "system";

const storedShade = (): Shade | null => {
  try {
    const v = localStorage.getItem(EFFECTIVE);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
};

/** Ставит тему в этом окне: CSS-переменные через data-theme и системное оформление окна (заголовок, поля ввода) */
export function applyTheme(t: Theme) {
  current = t;
  const shown: Theme = t === "system" && borrowSystem ? storedShade() ?? "system" : t;
  if (shown === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", shown);
  getCurrentWindow().setTheme(shown === "system" ? null : shown).catch(() => {});
}

/** Главное окно: какая тема получилась на экране (с учётом системы), для окон у края экрана */
export function shareShade() {
  const send = () => {
    const shade: Shade = current === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : current;
    try {
      localStorage.setItem(EFFECTIVE, shade);
    } catch {
      // окна у края возьмут тему из событий
    }
    emit("effective-theme", shade).catch(() => {});
  };
  send();
  // Через setTimeout: сначала тему применит само окно (applyTheme), потом отправляем, что получилось
  const later = () => void setTimeout(send, 0);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", later);
  addEventListener("inbox-theme", later);
  listen("theme-changed", later).catch(() => {});
}

/** Значок и компактный вид: «как в системе» значит «как в главном окне» */
export function borrowShade() {
  borrowSystem = true;
  listen<Shade>("effective-theme", (e) => {
    try {
      localStorage.setItem(EFFECTIVE, e.payload);
    } catch {
      // ниже применим и без памяти
    }
    applyTheme(current);
  }).catch(() => {});
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
