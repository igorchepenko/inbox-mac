import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/*
 * Место значка компактного вида и сочетание, которое открывает окно без мыши.
 * Хранятся не в базе профиля, а в compact.json рядом с базами (src-tauri/src/compact.rs): значок один на приложение
 * и ставится при запуске, до того как открылось хоть одно окно. Для окна настроек здесь чтение, запись и подписи.
 * После любой смены все окна получают событие compact-prefs с новыми настройками
 */

export type EdgeSide = "right" | "left";
export type EdgeScreen = "main" | "current";

export interface CompactPrefs {
  side: EdgeSide;
  screen: EdgeScreen;
  /** Сочетание в формате accelFromEvent из prefs.ts («Alt+Shift+Space»), пустая строка — без сочетания */
  key: string;
  /** Подпись, «⌥⇧Space» */
  label: string;
  /** Сочетание удалось занять */
  key_ok: boolean;
  /** Почему при запуске не удалось занять сохранённое сочетание */
  key_error: string | null;
}

/** Как DEFAULT_KEY в compact.rs */
export const DEFAULT_COMPACT_KEY = "Alt+Shift+Space";

export const DEFAULT_COMPACT_PREFS: CompactPrefs = {
  side: "right", screen: "main", key: DEFAULT_COMPACT_KEY, label: "⌥⇧Space", key_ok: false, key_error: null,
};

/** Подписи для выбора в настройках */
export const EDGE_SIDES: { id: EdgeSide; name: string }[] = [
  { id: "right", name: "Справа" },
  { id: "left", name: "Слева" },
];
export const EDGE_SCREENS: { id: EdgeScreen; name: string; tip: string }[] = [
  { id: "main", name: "Основной монитор", tip: "Значок всегда на мониторе со строкой меню" },
  { id: "current", name: "Текущий монитор", tip: "Значок переходит на монитор, где сейчас курсор" },
];

export const loadCompactPrefs = () => invoke<CompactPrefs>("compact_prefs").catch(() => DEFAULT_COMPACT_PREFS);

/** Край и монитор. Ошибка приходит строкой */
export const setCompactPlace = (side: EdgeSide, screen: EdgeScreen) => invoke<CompactPrefs>("set_compact_place", { side, screen });

/**
 * Сочетание компактного вида. Пустая строка убирает его. Если сочетание занято системой, другим приложением
 * или быстрым вводом, остаётся прежнее, а промис отклоняется с причиной
 */
export const setCompactKey = (accel: string) => invoke<CompactPrefs>("set_compact_shortcut", { accel });

export const onCompactPrefs = (cb: (p: CompactPrefs) => void): Promise<UnlistenFn> =>
  listen<CompactPrefs>("compact-prefs", (e) => cb(e.payload));
