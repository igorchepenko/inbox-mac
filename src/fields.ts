import type { Task } from "./db";
import type { Layout } from "./boardOps";
import { STAGES, stageOf } from "./boardOps";
import { fmtDay, fmtRange, fmtStamp, parseDay, stampDay, stampTime } from "./dates";
import { pingDue } from "./waiting";
import { openBlockers } from "./relations";
import { dueState, type DueTask } from "./due";
import { describe, parseRule } from "./recurrence";
import { priorityName } from "./priority";
import { QUADRANTS } from "./quadrants";

/*
 * Какие поля задачи видны в строке списка, на карточке канбана и на плашке календаря. Настраивается отдельно
 * для каждого вида в Настройках → «Поля задач». Название и галочка видны всегда.
 * Храним в таблице settings ключи fields:list, fields:board и fields:calendar: JSON со списком СКРЫТЫХ полей.
 * Так новое поле в будущей версии появится у всех сразу, а не потеряется в старом списке видимых.
 * Здесь же тексты подсказок при наведении на каждый элемент задачи. Чистая логика под тесты.
 */

export type FieldId =
  | "kind" | "priority" | "stage" | "date" | "time" | "due" | "remind" | "space"
  | "tags" | "assignee" | "participants" | "checklist" | "links" | "files" | "repeat" | "matrix" | "created";

export interface FieldInfo {
  id: FieldId;
  name: string;
  hint: string;
  /** Где поле бывает: этап на канбане и так виден по столбцу, на плашке календаря места только на главное */
  layouts: FieldView[];
}

/** Вид, для которого поля настраиваются отдельно */
export type FieldView = Layout | "calendar";

const BOTH: FieldView[] = ["list", "board"];
const ALL: FieldView[] = ["list", "board", "calendar"];

/** В порядке, в каком поля стоят в настройках */
export const FIELDS: FieldInfo[] = [
  { id: "kind", name: "Встреча", hint: "Значок перед названием у встреч", layouts: ALL },
  { id: "priority", name: "Важность", hint: "Стрелки важности", layouts: ALL },
  { id: "stage", name: "Этап", hint: "Новые, К выполнению, Готово, Отменено. На канбане этап и так виден по столбцу", layouts: ["list"] },
  { id: "date", name: "Дата", hint: "День, на который стоит задача", layouts: BOTH },
  { id: "time", name: "Время", hint: "Начало и конец, например 10:00–11:30. В календаре время подписано у плашки", layouts: ALL },
  { id: "due", name: "Срок", hint: "«до 18:00», когда указан только конец", layouts: BOTH },
  { id: "remind", name: "Напоминание", hint: "Когда придёт напоминание", layouts: BOTH },
  { id: "space", name: "Пространство", hint: "Плашка с названием пространства", layouts: ALL },
  { id: "tags", name: "Теги", hint: "В списке первые два, остальные числом", layouts: BOTH },
  { id: "assignee", name: "Кто назначил", hint: "Имя того, кто поставил задачу", layouts: BOTH },
  { id: "participants", name: "Участники", hint: "Число участников встречи, имена в подсказке", layouts: BOTH },
  { id: "checklist", name: "Чеклист", hint: "Сколько пунктов выполнено", layouts: BOTH },
  { id: "links", name: "Ссылки", hint: "Значок и число ссылок", layouts: BOTH },
  { id: "files", name: "Файлы", hint: "Значок и число файлов", layouts: BOTH },
  { id: "repeat", name: "Повтор", hint: "Значок у повторяющихся задач", layouts: BOTH },
  { id: "matrix", name: "Матрица", hint: "Квадрант матрицы Эйзенхауэра", layouts: BOTH },
  { id: "created", name: "Дата создания", hint: "Когда задачу записали", layouts: BOTH },
];

export const fieldsFor = (layout: FieldView) => FIELDS.filter((f) => f.layouts.includes(layout));

/** Изначально скрыты: участников раньше в строке не было, остальное видно как до настройки */
export const DEFAULT_HIDDEN: Record<FieldView, FieldId[]> = { list: ["participants"], board: ["participants"], calendar: [] };

export const fieldsKey = (layout: FieldView) => `fields:${layout}`;

/** Скрытые поля из настроек. Мусор и неизвестные поля пропускаем, без ключа — как по умолчанию */
export function hiddenFields(settings: Record<string, string>, layout: FieldView): FieldId[] {
  const raw = settings[fieldsKey(layout)];
  if (raw == null) return DEFAULT_HIDDEN[layout];
  try {
    const xs = JSON.parse(raw);
    return Array.isArray(xs) ? FIELDS.map((f) => f.id).filter((id) => xs.includes(id)) : DEFAULT_HIDDEN[layout];
  } catch {
    return DEFAULT_HIDDEN[layout];
  }
}

/** Проверка «показывать ли поле» для строки или карточки */
export type Shown = (id: FieldId) => boolean;
export const ALL_SHOWN: Shown = () => true;

export function shownFields(settings: Record<string, string>, layout: FieldView): Shown {
  const hidden = new Set(hiddenFields(settings, layout));
  return (id) => !hidden.has(id);
}

/** Новое значение ключа после переключения одного поля */
export function toggleField(settings: Record<string, string>, layout: FieldView, id: FieldId, on: boolean): string {
  const hidden = hiddenFields(settings, layout).filter((x) => x !== id);
  if (!on) hidden.push(id);
  return JSON.stringify(FIELDS.map((f) => f.id).filter((x) => hidden.includes(x)));
}

export const fieldsChanged = (settings: Record<string, string>, layout: FieldView) =>
  hiddenFields(settings, layout).join() !== DEFAULT_HIDDEN[layout].join();

export const DEFAULT_FIELDS_VALUE = (layout: FieldView) => JSON.stringify(DEFAULT_HIDDEN[layout]);

// ── Подсказки при наведении ──

const MAX_LINES = 8;

/** Не больше восьми строк, остальное числом: подсказка не должна закрыть пол-окна */
function lines(head: string, items: string[]): string {
  const shown = items.slice(0, MAX_LINES);
  const rest = items.length - shown.length;
  return [head, ...shown, ...(rest > 0 ? [`и ещё ${rest}`] : [])].join("\n");
}

/** «Пятница, 16 октября 2026», для сегодня и завтра ещё и слово: «Сегодня, пятница, 16 октября» */
export function fullDay(day: string): string {
  const d = parseDay(day);
  const long = d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).replace(/\s*г\.$/, "");
  const word = fmtDay(day);
  return /^\p{L}+$/u.test(word) ? `${word}, ${long}` : long.charAt(0).toUpperCase() + long.slice(1);
}

export const tips = {
  date: (x: Task, overdue: boolean) => `Дата: ${fullDay(x.due_date!)}${overdue ? ". Просрочена" : ""}`,
  time: (x: Task) => `Время: ${fmtRange(x.start_time, x.end_time)}${x.due_date ? `, ${fmtDay(x.due_date).toLowerCase()}` : ""}`,
  due: (x: DueTask) => {
    const state = dueState(x);
    return `Срок: ${x.due_date ? `${fmtDay(x.due_date).toLowerCase()} ` : ""}до ${x.end_time}${state === "overdue" ? ". Прошёл" : state === "soon" ? ". Скоро" : ""}`;
  },
  remind: (x: Task) => `Напоминание: ${fmtDay(stampDay(x.remind_at!)).toLowerCase()} в ${stampTime(x.remind_at!)}`,
  space: (name: string) => `Пространство: ${name}`,
  tag: (name: string) => `Тег: ${name}`,
  tagsRest: (names: string[]) => lines("Ещё теги:", names),
  assignee: (name: string) => `Назначил: ${name}`,
  waiting: (x: Task) => pingDue(x) ? `Пора напомнить: жду ${x.waiting_for}` : `Жду: ${x.waiting_for}${x.waiting_until ? `. Напомнить ${fmtDay(x.waiting_until).toLowerCase()}` : ""}`,
  blockedBy: (x: Task) => lines(`Заблокирована: ${openBlockers(x).length}`, openBlockers(x).map((r) => r.other_title)),
  blocking: (x: Task) => lines("Блокирует", x.relations.filter((r) => r.kind === "blocks" && !r.other_closed).map((r) => r.other_title)),
  related: (x: Task) => lines("Связана с", x.relations.filter((r) => r.kind === "related").map((r) => r.other_title)),
  participants: (names: string[]) => lines(`Участники: ${names.length}`, names),
  checklist: (x: Task) =>
    lines(`Чеклист: выполнено ${x.subtasks.filter((s) => s.done).length} из ${x.subtasks.length}`,
      x.subtasks.map((s) => `${s.done ? "✓" : "○"} ${s.title}`)),
  links: (x: Task) => lines(x.links.length > 1 ? `Ссылки: ${x.links.length}` : "Ссылка", x.links.map((l) => l.title || l.url)),
  files: (x: Task) => lines(x.files.length > 1 ? `Файлы: ${x.files.length}` : "Файл", x.files.map((f) => f.name)),
  repeat: (x: Task) => {
    const rule = parseRule(x.recurrence);
    return rule ? `Повтор: ${describe(rule).toLowerCase()}` : "Повторяется";
  },
  matrix: (q: number) => (QUADRANTS[q - 1] ? `Матрица: ${QUADRANTS[q - 1].name.toLowerCase()}, ${QUADRANTS[q - 1].hint}` : ""),
  priority: (p: number) => `Важность: ${priorityName(p).toLowerCase()}`,
  stage: (x: Task) => `Этап: ${STAGES.find((s) => s.key === stageOf(x))!.name}`,
  created: (x: Task) => `Создана ${fmtStamp(x.created_at)}`,
  meeting: (x: Pick<Task, "participants">) => (x.participants.length ? lines("Встреча, участники:", x.participants) : "Встреча"),
};
