/*
 * Как показываем человека. Чистая функция без зависимостей (её берут и db.ts, и people.ts).
 *  имя + фамилия            → «Имя Фамилия»
 *  фамилия + имя + отчество → «Фамилия Имя Отчество»
 *  только имя               → «Имя»
 * Имя с отчеством без фамилии показываем как «Имя Отчество».
 */
export interface NameParts {
  first_name: string;
  last_name: string;
  middle_name: string;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function personName(p: NameParts): string {
  const first = clean(p.first_name), last = clean(p.last_name), middle = clean(p.middle_name);
  const parts = middle && last ? [last, first, middle] : [first, last, middle];
  return parts.filter(Boolean).join(" ");
}
