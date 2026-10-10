// Важность в 5 градаций, значки как у приоритета в Jira: стрелки вверх и вниз, средняя «=»

export const PRIORITY = [
  { value: 1, name: "Минимальная", accent: "p1" },
  { value: 2, name: "Низкая", accent: "p2" },
  { value: 3, name: "Средняя", accent: "p3" },
  { value: 4, name: "Высокая", accent: "p4" },
  { value: 5, name: "Максимальная", accent: "p5" },
] as const;

export const priorityName = (p: number) => PRIORITY[p - 1]?.name ?? "";

// Шевроны и «=» в квадрате 16×16
const UP = "M3.5 10 8 5.5l4.5 4.5";
const DOWN = "M3.5 6 8 10.5 12.5 6";
const PATHS: Record<number, string[]> = {
  1: ["M3.5 3.5 8 8l4.5-4.5", "M3.5 8.5 8 13l4.5-4.5"],
  2: [DOWN],
  3: ["M3.5 6h9", "M3.5 10h9"],
  4: [UP],
  5: ["M3.5 7.5 8 3l4.5 4.5", "M3.5 12.5 8 8l4.5 4.5"],
};

/** Значок важности. color: свой цвет, например на закрашенной кнопке; по умолчанию цвет уровня */
export function PriorityIcon({ p, size = 14, color }: { p: number; size?: number; color?: string }) {
  const paths = PATHS[p];
  if (!paths) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="prio" aria-label={priorityName(p)} role="img"
      fill="none" stroke={color ?? `var(--p${p})`} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <title>Важность: {priorityName(p).toLowerCase()}</title>
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
