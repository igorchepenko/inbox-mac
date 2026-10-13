import { MONTHS_GEN } from "./dates";

/*
 * Первый запуск и два онбординга: чистая логика без React и базы, под тесты.
 * Состояние хранится в таблице settings, то есть у каждого профиля своё.
 */

/** Первый экран (имя и выбор онбординга) уже показан */
export const ONB_SEEN = "onb:seen";
/** Дата прохождения «Знакомства» и «Показать на деле» (ГГГГ-ММ-ДД) */
export const ONB_INTRO = "onb:intro";
export const ONB_TOUR = "onb:tour";
/** Баннер «Познакомиться с Inbox?» на дашборде скрыт */
export const ONB_BANNER_OFF = "onb:banner.off";

export type OnbKind = "intro" | "tour";

export const needsWelcome = (s: Record<string, string>) => s[ONB_SEEN] !== "1";

/** Показывать баннер на дашборде: первый экран прошёл, но ни один онбординг не пройден и баннер не скрыт */
export const showBanner = (s: Record<string, string>) => !needsWelcome(s) && !s[ONB_INTRO] && !s[ONB_TOUR] && s[ONB_BANNER_OFF] !== "1";

export const doneKey = (k: OnbKind) => (k === "intro" ? ONB_INTRO : ONB_TOUR);

/** Подпись состояния онбординга в настройках */
export function statusText(s: Record<string, string>, k: OnbKind): string {
  const d = s[doneKey(k)];
  return d ? `Пройден ${fmtDate(d)}` : "Не пройден";
}

/** 2026-10-13 → «13 октября 2026». Неразборчивое значение возвращается как есть */
export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS_GEN[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ── Подсветка ──

export interface Box { left: number; top: number; width: number; height: number }

/** Общая рамка нескольких элементов, чтобы подсветить группу целиком */
export function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const l = Math.min(...boxes.map((b) => b.left)), t = Math.min(...boxes.map((b) => b.top));
  const r = Math.max(...boxes.map((b) => b.left + b.width)), b = Math.max(...boxes.map((x) => x.top + x.height));
  return { left: l, top: t, width: r - l, height: b - t };
}

/**
 * Где поставить подсказку: справа от подсвеченного, иначе слева, снизу, сверху; в любом случае внутри окна.
 * Без цели подсказка по центру
 */
export function tipAt(target: Box | null, tip: { w: number; h: number }, view: { w: number; h: number }, gap = 14): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  if (!target) return { left: (view.w - tip.w) / 2, top: Math.max(24, (view.h - tip.h) / 3) };
  const midY = clamp(target.top + target.height / 2 - tip.h / 2, 12, view.h - tip.h - 12);
  const midX = clamp(target.left + target.width / 2 - tip.w / 2, 12, view.w - tip.w - 12);
  const right = target.left + target.width + gap, left = target.left - gap - tip.w;
  if (right + tip.w <= view.w - 12) return { left: right, top: midY };
  if (left >= 12) return { left, top: midY };
  const below = target.top + target.height + gap;
  if (below + tip.h <= view.h - 12) return { left: midX, top: below };
  return { left: midX, top: clamp(target.top - gap - tip.h, 12, view.h - tip.h - 12) };
}

// ── Шаги «Показать на деле» ──

export const DEMO_TITLE = "Позвонить @Андрей завтра в 15:00 #клиенты";
export const DEMO_TAG = "клиенты";

export interface TourStep {
  id: string;
  title: string;
  text: string;
  /** Селекторы подсвечиваемых элементов (объединяются). Нет элемента на экране: подсказка по центру */
  target?: string[];
  /** Вид, который нужно открыть перед шагом */
  view?: string;
  /** Что нужно сделать самому, чтобы идти дальше: ключ условия, которое проверяет оверлей */
  wait?: "created" | "selected" | "done";
  /** Подсказка рядом с кнопкой, пока действие не сделано */
  waitHint?: string;
}

export const TOUR_STEPS = (key: string): TourStep[] => [
  { id: "quick", title: "Быстрый ввод", text: `Нажми ${key} в любой программе: откроется строка поверх всего. Сейчас покажу ту же форму прямо здесь. Пример уже вписан, осталось нажать Enter.`, view: "inbox" },
  { id: "form", title: "Запиши задачу", target: ['[data-onb="form"]'], wait: "created", waitHint: "Нажми Enter в форме",
    text: "Дата и время, @человек и #тег распознаются прямо в названии. Нет такого тега или человека: появится сам. Нажми Enter." },
  { id: "list", title: "Задача в «Новых»", target: ['[data-onb="list"]'], view: "inbox", text: "Новая задача сначала лежит в «Новых». Когда разберёшь её, она уйдёт в работу." },
  { id: "smart", title: "Списки", target: ['[data-onb="nav:tasks"]', '[data-onb="nav:inbox"]', '[data-onb="nav:today"]', '[data-onb="nav:soon"]'],
    text: "«Задачи» — всё активное. «Новые», «Сегодня», «Скоро» — готовые фильтры того же списка. Можно включить несколько сразу." },
  { id: "spaces", title: "Пространства", target: ['[data-onb="spaces"]', '[data-onb="spaces-add"]'],
    text: "Пространство — большая область: Работа, Дом, Учёба. У задачи оно одно. Создаётся здесь или прямо при записи задачи." },
  { id: "tags", title: "Теги", target: ['[data-onb="tags"]', '[data-onb="tags-list"]'], text: "Метки поперёк пространств, у задачи их может быть несколько. Клик по тегу покажет все задачи с ним. #клиенты уже здесь." },
  { id: "people", title: "Люди", target: ['[data-onb="filter"]'], text: "Люди берутся из задач: тот, кто назначил, и участники встреч. Фильтр в шапке покажет задачи по человеку." },
  { id: "open", title: "Карточка задачи", target: ['[data-task-id="{demo}"]'], wait: "selected", waitHint: "Кликни по задаче", view: "inbox",
    text: "Клик по задаче открывает справа карточку: срок, описание, статус, теги. Попробуй." },
  { id: "done", title: "Завершение", target: ['[data-task-id="{demo}"] .chk'], wait: "done", waitHint: "Отметь кружок слева", view: "inbox",
    text: "Отметь кружок слева от названия: задача уйдёт из активных." },
  { id: "archive", title: "«Завершённые»", target: ['[data-onb="nav:archive"]', '[data-onb="list"]'], view: "archive",
    text: "Сделанное лежит здесь. Вернуть в работу можно в любой момент. Дальше учебная задача удалится." },
];
