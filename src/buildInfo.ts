import { MONTHS_GEN } from "./dates";

/** 2026-10-13 → «13 октября 2026». Неразборчивое значение возвращается как есть */
export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS_GEN[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}
