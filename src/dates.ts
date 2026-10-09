// Все даты храним в местном времени строками: день YYYY-MM-DD, момент YYYY-MM-DDTHH:MM

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return dayKey(new Date());
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function nowStamp(): string {
  const d = new Date();
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Ближайший понедельник после сегодняшнего дня */
export function nextMonday(): string {
  const d = new Date();
  const shift = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + shift);
  return dayKey(d);
}

const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function fmtDay(day: string): string {
  const t = today();
  if (day === t) return "Сегодня";
  if (day === addDays(t, 1)) return "Завтра";
  if (day === addDays(t, -1)) return "Вчера";
  const d = parseDay(day);
  const s = `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? s : `${s} ${d.getFullYear()}`;
}
