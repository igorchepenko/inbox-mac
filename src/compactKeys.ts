/*
 * Клавиатура в окне компактного вида (Compact.tsx): ↑ и ↓ ходят по задачам, ← и → по спискам, Enter открывает задачу.
 * Чистая логика под тесты
 */

/** Следующая строка: от края не перескакивает на другой край. Пустой список — null */
export function stepRow(cur: number | null, delta: 1 | -1, len: number): number | null {
  if (len <= 0) return null;
  if (cur == null) return delta > 0 ? 0 : len - 1;
  return Math.min(len - 1, Math.max(0, cur + delta));
}

/** Соседний список по кругу. lists — те, что видны в переключателе, по порядку */
export function stepList<T>(cur: T, delta: 1 | -1, lists: T[]): T {
  if (!lists.length) return cur;
  const i = lists.indexOf(cur);
  if (i < 0) return lists[0];
  return lists[(i + delta + lists.length) % lists.length];
}

/** Строка осталась в пределах списка после того, как он поменялся (задачу закрыли, список сменили) */
export function clampRow(cur: number | null, len: number): number | null {
  if (cur == null || len <= 0) return null;
  return Math.min(cur, len - 1);
}

export type CompactKey = "down" | "up" | "left" | "right" | "enter" | null;

/** Какую клавишу обрабатываем сами. В строке ввода стрелки и Enter остаются ей, кроме ↑ и ↓ (выход к списку) */
export function keyAction(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing">, inInput: boolean): CompactKey {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return null;
  if (inInput) return e.key === "ArrowUp" ? "up" : null;
  switch (e.key) {
    case "ArrowDown": return "down";
    case "ArrowUp": return "up";
    case "ArrowLeft": return "left";
    case "ArrowRight": return "right";
    case "Enter": return e.shiftKey ? null : "enter";
    default: return null;
  }
}
