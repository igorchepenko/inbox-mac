import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { profileKey } from "./profile";

/*
 * Настройки приложения.
 * Внешний вид (шрифт, размер) живёт в localStorage, как и тема: его нужно применить до первой отрисовки, без мигания.
 * Ключи localStorage у каждого профиля свои, см. profileKey.
 * Всё остальное хранится в таблице settings в базе и читается вместе с задачами.
 */

// ── Внешний вид ──

export type FontId = "system" | "rounded" | "serif" | "mono";
export type SizeId = "s" | "m" | "l" | "xl";
export interface Appearance {
  font: FontId;
  size: SizeId;
}

// Все шрифты системные, встроены в macOS: ничего не нужно скачивать
export const FONTS: { id: FontId; name: string; stack: string }[] = [
  { id: "system", name: "SF Pro", stack: '-apple-system, "SF Pro Text", system-ui, sans-serif' },
  { id: "rounded", name: "SF Rounded", stack: 'ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif' },
  { id: "serif", name: "New York", stack: 'ui-serif, "New York", Georgia, serif' },
  { id: "mono", name: "SF Mono", stack: 'ui-monospace, "SF Mono", Menlo, monospace' },
];

// Размер меняет масштаб всего окна, как ⌘+ в браузере: текст, отступы и иконки растут вместе
export const SIZES: { id: SizeId; name: string; zoom: number }[] = [
  { id: "s", name: "Мельче", zoom: 0.9 },
  { id: "m", name: "Обычный", zoom: 1 },
  { id: "l", name: "Крупнее", zoom: 1.1 },
  { id: "xl", name: "Крупный", zoom: 1.2 },
];

const APPEARANCE_KEY = "inbox.appearance";
export const DEFAULT_APPEARANCE: Appearance = { font: "system", size: "m" };

export function savedAppearance(): Appearance {
  try {
    const a = JSON.parse(localStorage.getItem(profileKey(APPEARANCE_KEY)) ?? "{}") as Partial<Appearance>;
    return {
      font: FONTS.some((f) => f.id === a.font) ? a.font! : DEFAULT_APPEARANCE.font,
      size: SIZES.some((s) => s.id === a.size) ? a.size! : DEFAULT_APPEARANCE.size,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

let zoom = 1;
/** Текущий масштаб окна: окну быстрого ввода он нужен, чтобы подогнать свою высоту */
export const currentZoom = () => zoom;

export function applyAppearance(a: Appearance) {
  const font = FONTS.find((f) => f.id === a.font) ?? FONTS[0];
  document.documentElement.style.setProperty("--font", font.stack);
  zoom = SIZES.find((s) => s.id === a.size)?.zoom ?? 1;
  getCurrentWebview().setZoom(zoom).catch(() => {});
  window.dispatchEvent(new Event("inbox-appearance"));
}

/** Выбор пользователя: запомнить и разослать второму окну */
export function setAppearance(a: Appearance) {
  try {
    localStorage.setItem(profileKey(APPEARANCE_KEY), JSON.stringify(a));
  } catch {
    // без localStorage настройка просто не переживёт перезапуск
  }
  applyAppearance(a);
  emit("appearance-changed", a).catch(() => {});
}

export function followAppearanceChanges() {
  listen<Appearance>("appearance-changed", (e) => applyAppearance(e.payload)).catch(() => {});
}

// ── Настройки в базе ──

export const DEFAULTS = {
  "quick.shortcut": "Alt+Space",
  "start.view": "home", // home, inbox, today, soon, calendar или last (где остановился)
  "remind.enabled": "1",
  "remind.sound": "Glass", // системный звук macOS или none
  "digest.enabled": "0", // утренняя сводка: сколько задач на сегодня и на разбор
  "digest.time": "09:00",
};
export type PrefKey = keyof typeof DEFAULTS;

export function pref(settings: Record<string, string>, key: PrefKey): string {
  return settings[key] ?? DEFAULTS[key];
}

// Системные звуки из /System/Library/Sounds
export const SOUNDS = ["Glass", "Ping", "Pop", "Hero", "Submarine", "Tink", "Funk"];

// ── Сочетание быстрого ввода ──

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS|CapsLock|Fn)/;

/**
 * Сочетание из нажатия в формате, который понимает Rust («Alt+Shift+KeyN»).
 * null, пока зажаты только модификаторы. Ошибка строкой, если сочетание не годится.
 */
export function accelFromEvent(e: KeyboardEvent): string | null | { error: string } {
  if (MODIFIER_CODES.test(e.code)) return null;
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
  const fkey = /^F\d+$/.test(e.code);
  if (!fkey && !e.ctrlKey && !e.altKey && !e.metaKey) return { error: "Нужен ⌥, ⌃ или ⌘ вместе с клавишей" };
  // ⌘ с одной клавишей перехватил бы ⌘C, ⌘V и другие команды во всех приложениях
  if (!fkey && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return { error: "⌘ с одной клавишей занят системными командами, добавь ⌥ или ⇧" };
  return [...mods, e.code].join("+");
}

const KEY_LABELS: Record<string, string> = {
  Space: "Space", Enter: "↩", Tab: "⇥", Backspace: "⌫", Escape: "Esc", Backquote: "`", Minus: "-", Equal: "=",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
};

/** «Alt+Shift+KeyN» → «⌥⇧N» в порядке, принятом в macOS */
export function labelFromAccel(accel: string): string {
  const parts = accel.split("+");
  const code = parts[parts.length - 1];
  const has = (m: string) => parts.includes(m);
  const mods = (has("Control") ? "⌃" : "") + (has("Alt") ? "⌥" : "") + (has("Shift") ? "⇧" : "") + (has("Super") ? "⌘" : "");
  const key = KEY_LABELS[code] ?? code.replace(/^Key|^Digit/, "");
  return mods + key;
}

let quickLabel = labelFromAccel(DEFAULTS["quick.shortcut"]);
/** Подпись текущего сочетания быстрого ввода для подсказок в интерфейсе */
export const quickKeyLabel = () => quickLabel;
export const setQuickKeyLabel = (accel: string) => {
  quickLabel = labelFromAccel(accel);
};
