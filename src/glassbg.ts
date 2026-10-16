import { emit, listen } from "@tauri-apps/api/event";
import { profileKey } from "./profile";

/** Фон темы «Стекло»: разноцветный (как был) или одноцветный, отдельный цвет для светлой и тёмной темы,
    сила размытия и прозрачность ползунками, акцент в тон фону */
export type GlassBg = {
  mode: "multi" | "solid";
  light: string; // #RRGGBB для светлой темы
  dark: string; // #RRGGBB для тёмной темы
  blur: number; // 0..100, 50 = как было (30px)
  opacity: number; // 0..100, 50 = как было
  tint: boolean; // акцент в тон фону (только для одноцветного)
};

export const DEFAULT_GLASS: GlassBg = { mode: "multi", light: "#DCE6F5", dark: "#182036", blur: 50, opacity: 50, tint: false };

/** Готовые цвета: пара для светлой и тёмной темы */
export const GLASS_PRESETS: { id: string; name: string; light: string; dark: string }[] = [
  { id: "sky", name: "Небо", light: "#DCE6F5", dark: "#182036" },
  { id: "mint", name: "Мята", light: "#D6EEE4", dark: "#12302A" },
  { id: "lilac", name: "Сирень", light: "#E4DCF3", dark: "#241B3D" },
  { id: "rose", name: "Роза", light: "#F3DCE5", dark: "#35182A" },
  { id: "sand", name: "Песок", light: "#F1E7D2", dark: "#34291A" },
  { id: "slate", name: "Графит", light: "#DADFE7", dark: "#1B1F29" },
];

const KEY = "inbox.glassbg";
const HEX = /^#[0-9a-fA-F]{6}$/;

const clamp = (n: unknown, d: number) => (typeof n === "number" && isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : d);

export function parseGlass(raw: string | null): GlassBg {
  try {
    const o = JSON.parse(raw ?? "null") as Partial<GlassBg> | null;
    if (!o || typeof o !== "object") return DEFAULT_GLASS;
    return {
      mode: o.mode === "solid" ? "solid" : "multi",
      light: typeof o.light === "string" && HEX.test(o.light) ? o.light : DEFAULT_GLASS.light,
      dark: typeof o.dark === "string" && HEX.test(o.dark) ? o.dark : DEFAULT_GLASS.dark,
      blur: clamp(o.blur, 50),
      opacity: clamp(o.opacity, 50),
      tint: o.tint === true,
    };
  } catch {
    return DEFAULT_GLASS;
  }
}

export function savedGlass(): GlassBg {
  try {
    return parseGlass(localStorage.getItem(profileKey(KEY)));
  } catch {
    return DEFAULT_GLASS;
  }
}

/** Размытие в пикселях: 0..100 → 0..60, середина 30 */
export const blurPx = (v: number) => Math.round((v / 100) * 60);
/** Множитель непрозрачности стекла: 0..100 → 0.3..1.7, середина 1 */
export const opacityK = (v: number) => +(0.3 + (v / 100) * 1.4).toFixed(3);

function hue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d === 0) return 210;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

/** Акцент (кнопки, выделение) в тон фону; у почти серого цвета оттенок слабый, поэтому насыщенность низкая */
export function tintAccent(hex: string, dark: boolean): string {
  const sat = Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))) - Math.min(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))) < 12 ? 12 : 60;
  return dark ? `hsl(${hue(hex)} ${sat + 5}% 66%)` : `hsl(${hue(hex)} ${sat}% 36%)`;
}

function isDark(): boolean {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const OWN = ["--glass-blur", "--glass-k", "--wall", "--bg", "--stand", "--sel"];

/** Ставит фон «Стекла» в этом окне через переменные на корне; вне «Стекла» убирает свои */
export function applyGlass(g: GlassBg, glass: boolean) {
  const s = document.documentElement.style;
  OWN.forEach((p) => s.removeProperty(p));
  if (!glass) return;
  s.setProperty("--glass-blur", `${blurPx(g.blur)}px`);
  s.setProperty("--glass-k", String(opacityK(g.opacity)));
  if (g.mode !== "solid") return;
  const c = isDark() ? g.dark : g.light;
  s.setProperty("--wall", c);
  s.setProperty("--bg", c);
  if (g.tint) {
    const a = tintAccent(c, isDark());
    s.setProperty("--stand", a);
    s.setProperty("--sel", `color-mix(in srgb, ${a} 18%, transparent)`);
  }
}

function current() {
  return applyGlass(savedGlass(), document.documentElement.getAttribute("data-look") === "glass");
}

export function setGlass(g: GlassBg) {
  try {
    localStorage.setItem(profileKey(KEY), JSON.stringify(g));
  } catch {
    // без localStorage фон не переживёт перезапуск
  }
  current();
  emit("glassbg-changed", g).catch(() => {});
}

/** Подписка: смена темы, стиля, системной темы и настройки из другого окна */
export function followGlass() {
  current();
  listen("glassbg-changed", current).catch(() => {});
  listen("look-changed", current).catch(() => {});
  listen("theme-changed", current).catch(() => {});
  window.addEventListener("inbox-theme", current);
  window.addEventListener("inbox-look", current);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", current);
}
