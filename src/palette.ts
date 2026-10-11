import type React from "react";

/*
 * Палитра пространств: 40 ярких цветов, по строке на семейство оттенков.
 * Системные цвета (move красный, exercise зелёный, stand бирюзовый) сюда не входят: они означают разбор, сделано и время.
 * В базе у проекта хранится id цвета, в CSS он доступен как var(--<id>), поэтому старые места с `var(--${color})` работают без правок.
 * У каждого цвета есть пара var(--<id>-ink): белый или чёрный, что контрастнее на этом цвете в текущей теме.
 * Ею пишут текст и иконку поверх заливки (пункт меню, метка на задаче).
 */

export interface Swatch {
  id: string;
  name: string;
  light: string;
  dark: string;
}

export const PALETTE: Swatch[] = [
  // Красные, оранжевые, жёлтые
  { id: "scarlet", name: "Алый", light: "#FF2D2D", dark: "#FF4F4F" },
  { id: "coral", name: "Коралловый", light: "#FF5A3C", dark: "#FF7759" },
  { id: "orange", name: "Оранжевый", light: "#FF6A00", dark: "#FF8A2B" },
  { id: "tangerine", name: "Мандариновый", light: "#FF9500", dark: "#FFA826" },
  { id: "sunflower", name: "Подсолнух", light: "#FFC300", dark: "#FFCC1A" },
  { id: "lemon", name: "Лимонный", light: "#FFE600", dark: "#FFEB3B" },
  { id: "gold", name: "Золотой", light: "#E0A800", dark: "#F5C02E" },
  { id: "peach", name: "Персиковый", light: "#FF8A65", dark: "#FFA488" },
  // Розовые
  { id: "wine", name: "Винный", light: "#B0124F", dark: "#E0447F" },
  { id: "raspberry", name: "Малиновый", light: "#F0136E", dark: "#FF4D8F" },
  { id: "rose", name: "Пудровый", light: "#F06A8A", dark: "#FF8FA8" },
  { id: "pink", name: "Розовый", light: "#FF3FA4", dark: "#FF66B8" },
  { id: "magenta", name: "Пурпурный", light: "#FF00C8", dark: "#FF3DD6" },
  { id: "orchid", name: "Орхидея", light: "#D132E0", dark: "#E266F0" },
  { id: "plum", name: "Сливовый", light: "#9B27B0", dark: "#C060D6" },
  { id: "lilac", name: "Сиреневый", light: "#B07CFF", dark: "#C49BFF" },
  // Фиолетовые и синие
  { id: "purple", name: "Лиловый", light: "#9B3DFF", dark: "#B06BFF" },
  { id: "violet", name: "Фиолетовый", light: "#7046E0", dark: "#A688FF" },
  { id: "lavender", name: "Лавандовый", light: "#8A7DFF", dark: "#A99FFF" },
  { id: "indigo", name: "Индиго", light: "#4F46E5", dark: "#7C7CFF" },
  { id: "ink", name: "Чернильный", light: "#3B2E9E", dark: "#7A6EF0" },
  { id: "royal", name: "Королевский", light: "#2453FF", dark: "#5C7DFF" },
  { id: "blue", name: "Синий", light: "#2E62E8", dark: "#6E9BFF" },
  { id: "cornflower", name: "Васильковый", light: "#5B8CFF", dark: "#86AAFF" },
  // Голубые и бирюзовые
  { id: "cobalt", name: "Кобальт", light: "#0047AB", dark: "#4D8AEB" },
  { id: "navy", name: "Тёмно-синий", light: "#1F3C8F", dark: "#6F8EE6" },
  { id: "ocean", name: "Морской", light: "#0A6BB8", dark: "#3AA0EB" },
  { id: "sky", name: "Небесный", light: "#00A3FF", dark: "#3DB8FF" },
  { id: "cyan", name: "Циан", light: "#00C8F0", dark: "#2EE0FF" },
  { id: "aqua", name: "Аква", light: "#00E0D0", dark: "#3AF0E0" },
  { id: "teal", name: "Морская волна", light: "#00A99D", dark: "#2ED1C2" },
  { id: "mint", name: "Мятный", light: "#00D49A", dark: "#3EEBB4" },
  // Зелёные и нейтральные
  { id: "emerald", name: "Изумрудный", light: "#00A86B", dark: "#2ED68F" },
  { id: "pine", name: "Хвойный", light: "#12705A", dark: "#4DB894" },
  { id: "green", name: "Зелёный", light: "#22C43A", dark: "#4ADE5C" },
  { id: "neon", name: "Неоновый", light: "#39FF14", dark: "#5CFF3D" },
  { id: "lime", name: "Лаймовый", light: "#9BE01A", dark: "#B5F23D" },
  { id: "chartreuse", name: "Шартрез", light: "#D4F500", dark: "#DEFF33" },
  { id: "cocoa", name: "Шоколадный", light: "#8B5A2B", dark: "#C08A5A" },
  { id: "slate", name: "Сланцевый", light: "#52657F", dark: "#9AAAC2" },
];

export type PaletteId = string;

/** Цвет пространства для элемента: --pc заливка или полоска, --pc-ink текст поверх заливки */
export const spaceVars = (color: string | undefined) =>
  (color
    ? { "--pc": `var(--${color})`, "--pc-ink": `var(--${color}-ink, var(--on-acc))` }
    : {}) as React.CSSProperties;

export const swatchOf = (id: string) => PALETTE.find((s) => s.id === id);

/**
 * Белый или чёрный текст на цвете. Чистый контраст WCAG ставит чёрный уже на алый и розовый, а там привычнее белый,
 * поэтому белый держим, пока относительная яркость цвета ниже 0,33 (контраст с белым от 2,8 и выше).
 */
export function inkFor(hex: string): string {
  const ch = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  return l < 0.33 ? "#FFFFFF" : "#0D0F12";
}

/** CSS-переменные палитры для обеих тем. :root:root перебивает старые значения из styles.css */
function css(): string {
  const vars = (k: "light" | "dark") => PALETTE.map((s) => `--${s.id}: ${s[k]}; --${s.id}-ink: ${inkFor(s[k])};`).join(" ");
  return `:root:root { ${vars("light")} }
@media (prefers-color-scheme: dark) { :root:root:not([data-theme="light"]) { ${vars("dark")} } }
:root:root[data-theme="dark"] { ${vars("dark")} }`;
}

export function installPalette() {
  if (document.getElementById("palette-vars")) return;
  const el = document.createElement("style");
  el.id = "palette-vars";
  el.textContent = css();
  document.head.appendChild(el);
}

/** Цвет нового пространства, когда его создают прямо из задачи: первый из палитры, которого ещё нет у других */
export function nextSpaceColor(used: string[]): string {
  return (PALETTE.find((s) => !used.includes(s.id)) ?? PALETTE[used.length % PALETTE.length]).id;
}
