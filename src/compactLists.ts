import type { Task } from "./db";
import { fmtDay, today } from "./dates";
import { countFor, listFor, revOf, sortOf, sortsFor, VIEWS, type ListItem, type SortBy, type ViewId } from "./views";
import { FIELDS, type FieldId, type Shown } from "./fields";
import { needle, searchTasks } from "./search";

/*
 * Компактный вид (окно у значка на краю экрана): какие списки, в каком порядке и что писать в строке задачи.
 * Чистая логика под тесты, окно — в Compact.tsx (файл назван иначе: на macOS имена без учёта регистра)
 */

/** Списки в переключателе компактного вида, по порядку */
export const COMPACT_LISTS: ViewId[] = ["tasks", "inbox", "today", "overdue", "soon", "waiting"];

export const listName = (v: ViewId) => VIEWS.find((x) => x.id === v)?.name ?? "";
export const listAccent = (v: ViewId) => VIEWS.find((x) => x.id === v)?.accent ?? "stand";
/** Иконка списка: своя, если её поменяли в меню главного окна (settings icon:<вид>) */
export const listIcon = (v: ViewId, settings: Record<string, string>) => settings[`icon:${v}`] ?? VIEWS.find((x) => x.id === v)?.icon ?? "tasks";

const STORE = "inbox.compact.view";
export function savedList(): ViewId {
  try {
    const v = localStorage.getItem(STORE) as ViewId | null;
    return v && COMPACT_LISTS.includes(v) ? v : "tasks";
  } catch {
    return "tasks";
  }
}
export function saveList(v: ViewId) {
  try {
    localStorage.setItem(STORE, v);
  } catch {
    /* без памяти о выборе тоже работает */
  }
}

/*
 * Настройки компактного вида живут в settings профиля отдельно от главного окна:
 *  compact:sort:<список> — сортировка, «priority» или «priority:rev» (обратный порядок); без ключа — как в главном окне;
 *  compact:row — JSON с полями, ВИДИМЫМИ в строке (по умолчанию только дата, время и срок);
 *  compact:card — JSON со СКРЫТЫМИ полями карточки задачи (по умолчанию видно всё заполненное);
 *  compact:zoom — масштаб окна, например 0.9
 */
export const sortKey = (v: ViewId) => `compact:sort:${v}`;
export const ROW_KEY = "compact:row";
export const CARD_KEY = "compact:card";
export const ZOOM_KEY = "compact:zoom";

/** Сортировка списка в компактном виде: своя, если выбрана в его настройках, иначе как в главном окне */
export function compactSort(view: ViewId, settings: Record<string, string>): { sort: SortBy; rev: boolean; own: boolean } {
  const [id, dir] = (settings[sortKey(view)] ?? "").split(":");
  const own = sortsFor(view).find((x) => x.id === id);
  if (own) return { sort: own.id, rev: dir === "rev", own: true };
  const sort = sortOf(view, settings);
  return { sort, rev: revOf(view, sort, settings), own: false };
}
export const sortValue = (sort: SortBy, rev: boolean) => (rev ? `${sort}:rev` : sort);

/** Поля строки: те же, что в настройках полей главного окна */
export const ROW_FIELDS = FIELDS;
export const ROW_DEFAULT: FieldId[] = ["date", "time", "due"];

function parseIds<T extends string>(raw: string | undefined, known: readonly T[], fallback: T[]): T[] {
  if (raw == null) return fallback;
  try {
    const xs = JSON.parse(raw);
    return Array.isArray(xs) ? known.filter((id) => xs.includes(id)) : fallback;
  } catch {
    return fallback;
  }
}

export const rowFields = (settings: Record<string, string>) => parseIds(settings[ROW_KEY], ROW_FIELDS.map((f) => f.id), ROW_DEFAULT);
export function rowShown(settings: Record<string, string>): Shown {
  const on = new Set(rowFields(settings));
  return (id) => on.has(id);
}

/** Поля карточки задачи в компактном виде, по порядку. Пустое поле не показывается, даже если включено */
export const CARD_FIELDS = [
  { id: "stage", name: "Этап" },
  { id: "kind", name: "Встреча" },
  { id: "tags", name: "Теги" },
  { id: "date", name: "Дата" },
  { id: "time", name: "Время" },
  { id: "due", name: "Срок" },
  { id: "remind", name: "Напоминание" },
  { id: "repeat", name: "Повтор" },
  { id: "priority", name: "Важность" },
  { id: "matrix", name: "Матрица" },
  { id: "space", name: "Пространство" },
  { id: "waiting", name: "Жду" },
  { id: "assignee", name: "Кто назначил" },
  { id: "participants", name: "Участники" },
  { id: "relations", name: "Связи" },
  { id: "checklist", name: "Чеклист" },
  { id: "links", name: "Ссылки" },
  { id: "files", name: "Файлы" },
  { id: "note", name: "Заметка" },
  { id: "summary", name: "Итоги" },
  { id: "created", name: "Создана" },
  { id: "triaged", name: "Разобрана" },
] as const;
export type CardField = (typeof CARD_FIELDS)[number]["id"];

export const cardHidden = (settings: Record<string, string>) => parseIds<CardField>(settings[CARD_KEY], CARD_FIELDS.map((f) => f.id), []);
export function cardShown(settings: Record<string, string>): (id: CardField) => boolean {
  const off = new Set(cardHidden(settings));
  return (id) => !off.has(id);
}

/** Новое значение ключа после переключения: для строки храним видимые, для карточки скрытые */
export function toggleIn<T extends string>(list: T[], id: T, add: boolean): string {
  const next = list.filter((x) => x !== id);
  if (add) next.push(id);
  return JSON.stringify(next);
}

/*
 * Какие списки и в каком порядке в переключателе:
 *  compact:order — JSON с порядком списков (новые в будущем дописываются в конец);
 *  compact:hide-empty — «1»: списки без задач прячутся, кроме «Задач» и открытого сейчас
 */
export const ORDER_KEY = "compact:order";
export const HIDE_EMPTY_KEY = "compact:hide-empty";

export function listOrder(settings: Record<string, string>): ViewId[] {
  let saved: ViewId[] = [];
  try {
    const xs = JSON.parse(settings[ORDER_KEY] ?? "[]");
    if (Array.isArray(xs)) saved = xs.filter((x, i): x is ViewId => COMPACT_LISTS.includes(x) && xs.indexOf(x) === i);
  } catch {
    /* мусор — порядок по умолчанию */
  }
  return [...saved, ...COMPACT_LISTS.filter((v) => !saved.includes(v))];
}
export const hideEmpty = (settings: Record<string, string>) => settings[HIDE_EMPTY_KEY] === "1";

/** Списки переключателя: в своём порядке, без пустых, если так выбрано. «Задачи» и открытый список остаются всегда */
export function compactTabs(settings: Record<string, string>, tasks: Task[], current: ViewId): ViewId[] {
  const hide = hideEmpty(settings);
  return listOrder(settings).filter((v) => !hide || v === "tasks" || v === current || countFor(v, tasks) > 0);
}

/** Новый порядок после сдвига списка на шаг (-1 вверх, 1 вниз) */
export function moveList(order: ViewId[], v: ViewId, step: -1 | 1): ViewId[] {
  const i = order.indexOf(v);
  const j = i + step;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export const ZOOM = { min: 0.75, max: 1.2, step: 0.05, def: 0.9 };
export function zoomOf(settings: Record<string, string>): number {
  const z = Number(settings[ZOOM_KEY]);
  return Number.isFinite(z) && z >= ZOOM.min && z <= ZOOM.max ? z : ZOOM.def;
}

/**
 * Строки списка в выбранной сортировке. При сортировке по дате заголовки по дням не нужны: дата и так в строке.
 * Группы остальных сортировок (по тегам, важности…) и люди в «Жду» остаются
 */
export function compactItems(view: ViewId, tasks: Task[], settings: Record<string, string> = {}): ListItem[] {
  const { sort, rev } = compactSort(view, settings);
  const items = listFor(view, tasks, sort, rev);
  return view === "waiting" || sort !== "date" ? items : items.map(({ task }) => ({ task }));
}

/** Дата в строке: «Сегодня», «Завтра», «Пт, 14 ноя», со временем, если оно есть. Без даты — null */
export function dueLabel(x: Pick<Task, "due_date" | "start_time" | "end_time">): string | null {
  if (!x.due_date) return null;
  const day = fmtDay(x.due_date);
  if (x.start_time) return `${day}, ${x.start_time}`;
  if (x.end_time) return `${day}, до ${x.end_time}`;
  return day;
}

/** Цвет даты: красный — день прошёл, янтарный — сегодня */
export function dueTone(x: Pick<Task, "due_date">, t = today()): "overdue" | "today" | null {
  if (!x.due_date) return null;
  if (x.due_date < t) return "overdue";
  return x.due_date === t ? "today" : null;
}

/** В каком списке показывать найденную задачу, если она есть в нескольких: сначала самый узкий, «Задачи» — последним */
const SEARCH_ORDER: ViewId[] = ["inbox", "overdue", "today", "soon", "waiting", "tasks"];

/**
 * Поиск по названию сразу по всем шести спискам. Каждая задача один раз, под заголовком своего списка;
 * внутри списка порядок и сортировка те же, что в самом списке компактного вида. Пустой запрос — пусто
 */
export function compactSearch(query: string, tasks: Task[], settings: Record<string, string> = {}): ListItem[] {
  if (!needle(query)) return [];
  const seen = new Set<number>();
  const out: ListItem[] = [];
  for (const v of SEARCH_ORDER) {
    const found = searchTasks(query, compactItems(v, tasks, settings).map((i) => i.task)).filter((x) => !seen.has(x.id));
    found.forEach((x, i) => (seen.add(x.id), out.push({ task: x, group: i === 0 ? listName(v) : undefined })));
  }
  return out;
}
