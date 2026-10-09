/*
 * Палитра проектов: 32 чистых цвета, по строке на семейство оттенков.
 * Системные цвета (move красный, exercise зелёный, stand бирюзовый) сюда не входят: они означают разбор, сделано и время.
 * В базе у проекта хранится id цвета, в CSS он доступен как var(--<id>), поэтому старые места с `var(--${color})` работают без правок.
 * Светлый вариант достаточно тёмный под белый текст на метке, тёмный вариант светлый под тёмный текст.
 */

export interface Swatch {
  id: string;
  name: string;
  light: string;
  dark: string;
}

export const PALETTE: Swatch[] = [
  // Тёплые
  { id: "scarlet", name: "Алый", light: "#E8363C", dark: "#FF6B6F" },
  { id: "coral", name: "Коралловый", light: "#EF5A38", dark: "#FF8B6E" },
  { id: "orange", name: "Оранжевый", light: "#E2640F", dark: "#FF8A3D" },
  { id: "tangerine", name: "Мандариновый", light: "#EC8500", dark: "#FFB547" },
  { id: "gold", name: "Золотой", light: "#D49A00", dark: "#FFD33D" },
  { id: "peach", name: "Персиковый", light: "#E8784F", dark: "#FFB59E" },
  { id: "rose", name: "Пудровый", light: "#D65C78", dark: "#FFADBD" },
  { id: "wine", name: "Винный", light: "#A8174F", dark: "#F0709F" },
  // Розовые и фиолетовые
  { id: "raspberry", name: "Малиновый", light: "#D6246E", dark: "#FF6FA8" },
  { id: "pink", name: "Розовый", light: "#E0449F", dark: "#FF8DCB" },
  { id: "orchid", name: "Орхидея", light: "#C13CC6", dark: "#F08AF3" },
  { id: "plum", name: "Сливовый", light: "#8F2FA3", dark: "#D38DEB" },
  { id: "lilac", name: "Сиреневый", light: "#A062DD", dark: "#D9B8FF" },
  { id: "purple", name: "Лиловый", light: "#8D44E3", dark: "#BC8EFF" },
  { id: "violet", name: "Фиолетовый", light: "#7046E0", dark: "#A688FF" },
  { id: "lavender", name: "Лавандовый", light: "#7B6BE6", dark: "#C2B9FF" },
  // Синие
  { id: "indigo", name: "Индиго", light: "#4848D6", dark: "#8E8EFF" },
  { id: "ink", name: "Чернильный", light: "#3B2E9E", dark: "#9D92F5" },
  { id: "royal", name: "Королевский", light: "#2C49C9", dark: "#7E95FF" },
  { id: "blue", name: "Синий", light: "#2E62E8", dark: "#6E9BFF" },
  { id: "cornflower", name: "Васильковый", light: "#4F7FE8", dark: "#A0C1FF" },
  { id: "cobalt", name: "Кобальт", light: "#0F4FAE", dark: "#6C9BEB" },
  { id: "navy", name: "Тёмно-синий", light: "#1F3C8F", dark: "#8BA6F2" },
  { id: "sky", name: "Небесный", light: "#0B86D8", dark: "#5DC3FF" },
  // Морские, зелёные и нейтральный
  { id: "ocean", name: "Морской", light: "#0A5E9C", dark: "#52B1F0" },
  { id: "teal", name: "Морская волна", light: "#11998E", dark: "#4FE0D0" },
  { id: "mint", name: "Мятный", light: "#0EAA84", dark: "#52E5BE" },
  { id: "emerald", name: "Изумрудный", light: "#079669", dark: "#36D49A" },
  { id: "pine", name: "Хвойный", light: "#12705A", dark: "#6DCCAE" },
  { id: "green", name: "Зелёный", light: "#2F9E44", dark: "#6BDB7E" },
  { id: "lime", name: "Лаймовый", light: "#6AA712", dark: "#AEE650" },
  { id: "slate", name: "Сланцевый", light: "#52657F", dark: "#9AAAC2" },
];

export type PaletteId = string;

export const swatchOf = (id: string) => PALETTE.find((s) => s.id === id);

/** CSS-переменные палитры для обеих тем. :root:root перебивает старые значения из styles.css */
function css(): string {
  const vars = (k: "light" | "dark") => PALETTE.map((s) => `--${s.id}: ${s[k]};`).join(" ");
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
