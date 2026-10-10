// Перетаскивание на указателе мыши (pointer events). HTML5 drag-and-drop в WebView macOS занят файлами из Finder,
// поэтому канбан, календарь и списки тянутся через pointerdown/move/up. Здесь общее для всех: порог начала,
// слежение за курсором по всему окну, прокрутка у края, плавная перестановка и сортируемый список.
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** Сколько пикселей надо протащить, чтобы нажатие стало перетаскиванием, а не кликом */
export const DRAG_THRESHOLD = 4;
export const EASE = "cubic-bezier(.2, .8, .2, 1)";

export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Курсор ушёл от точки нажатия дальше порога */
export const pastThreshold = (x0: number, y0: number, x: number, y: number, threshold = DRAG_THRESHOLD) =>
  Math.hypot(x - x0, y - y0) > threshold;

/**
 * Прокрутка у края: курсор ближе zone к началу или концу области — шаг speed в эту сторону, иначе 0.
 * lo и hi — границы области по нужной оси
 */
export function edgeScroll(pos: number, lo: number, hi: number, zone: number, speed: number): number {
  if (pos < lo + zone) return -speed;
  if (pos > hi - zone) return speed;
  return 0;
}

/**
 * Следит за курсором по всему окну, пока кнопка не отпущена. up срабатывает и на pointercancel.
 * Возвращает функцию, которая снимает слежение досрочно (повторный вызов безопасен)
 */
export function trackPointer(handlers: { move: (e: PointerEvent) => void; up: (e: PointerEvent) => void }): () => void {
  const stop = () => {
    window.removeEventListener("pointermove", handlers.move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  };
  const up = (e: PointerEvent) => {
    stop();
    handlers.up(e);
  };
  window.addEventListener("pointermove", handlers.move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  return stop;
}

// Перестановка в списке

/** Новый массив, где элемент с места from стоит на месте to */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

/**
 * Куда встанет строка, если её сдвинуть на dy: столько соседей, чей центр выше центра строки в руке.
 * tops и heights — положение и высота строк до начала перетаскивания
 */
export function dropIndex(tops: readonly number[], heights: readonly number[], from: number, dy: number): number {
  const center = tops[from] + heights[from] / 2 + dy;
  return tops.filter((t, j) => j !== from && t + heights[j] / 2 < center).length;
}

/** На сколько сдвинуть соседа i, чтобы освободить место: строка в руке занимает size пикселей вместе с отступом */
export function neighborShift(i: number, from: number, to: number, size: number): number {
  if (from < to && i > from && i <= to) return -size;
  if (to < from && i >= to && i < from) return size;
  return 0;
}

/**
 * Плавная перестановка (FLIP): до обновления запоминаем, где стояли элементы с атрибутом data-<attr>,
 * после него сдвигаем каждый обратно и отпускаем анимацией на новое место. key меняется — значит, порядок другой.
 * Элементы с классом landing пропускаются: на их место садится призрак перетаскивания
 */
export function useFlip(root: RefObject<HTMLElement | null>, key: string, opts: { attr?: string; duration?: number } = {}) {
  const attr = opts.attr ?? "card";
  const last = useRef(key);
  const before = useRef<Map<string, DOMRect> | null>(null);
  const all = () => root.current?.querySelectorAll<HTMLElement>(`[data-${attr}]`) ?? [];
  // Замер в теле рендера: DOM ещё показывает прошлое состояние
  if (last.current !== key && root.current && !before.current) {
    before.current = new Map();
    all().forEach((el) => before.current!.set(el.getAttribute(`data-${attr}`)!, el.getBoundingClientRect()));
  }
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    last.current = key;
    if (!prev || !root.current || reduceMotion()) return;
    all().forEach((el) => {
      const a = prev.get(el.getAttribute(`data-${attr}`)!);
      if (!a || el.classList.contains("landing")) return;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: opts.duration ?? 260, easing: EASE });
    });
  }, [key, root]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Список, который переставляют, таская строку за ручку. Строки — прямые потомки listRef.
 * Пока тянут, строка едет за курсором, соседи расступаются; после отпускания строка доезжает на новое место.
 * onDrop(from, to) должен сразу поставить строку на новое место в данных (setState), запись в базу — уже потом
 */
export function useSortable(opts: { disabled?: boolean; onDrop: (from: number, to: number) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const geo = useRef<{ tops: number[]; hs: number[]; startY: number }>({ tops: [], hs: [], startY: 0 });
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  const [settle, setSettle] = useState<{ index: number; offset: number } | null>(null);
  useLayoutEffect(() => {
    if (!settle) return;
    const f = requestAnimationFrame(() => requestAnimationFrame(() => setSettle(null)));
    return () => cancelAnimationFrame(f);
  }, [settle]);

  const start = (e: ReactPointerEvent, i: number) => {
    if (opts.disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rows = [...(listRef.current?.children ?? [])] as HTMLElement[];
    geo.current = { tops: rows.map((r) => r.offsetTop), hs: rows.map((r) => r.offsetHeight), startY: e.clientY };
    setDrag({ from: i, to: i, dy: 0 });
  };
  const move = (e: ReactPointerEvent) => {
    if (!drag) return;
    const { tops, hs, startY } = geo.current;
    const dy = e.clientY - startY;
    setDrag({ ...drag, dy, to: dropIndex(tops, hs, drag.from, dy) });
  };
  const end = () => {
    if (!drag) return;
    const { from, to, dy } = drag;
    setDrag(null);
    if (from === to) return;
    const { tops } = geo.current;
    // Строка плавно доезжает из точки, где её отпустили, на новое место
    setSettle({ index: to, offset: tops[from] + dy - tops[to] });
    opts.onDrop(from, to);
  };

  /** Обработчики для ручки строки i */
  const grip = (i: number) => ({ onPointerDown: (e: ReactPointerEvent) => start(e, i), onPointerMove: move, onPointerUp: end, onPointerCancel: end });

  /** Сдвиг строки i во время перетаскивания */
  const rowStyle = (i: number): CSSProperties => {
    if (settle) return i === settle.index ? { transform: `translateY(${settle.offset}px)`, transition: "none" } : { transition: "none" };
    if (!drag) return {};
    const { hs, tops } = geo.current;
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, transition: "none", zIndex: 2 };
    const gap = tops.length > 1 ? tops[1] - tops[0] - hs[0] : 0;
    const dy = neighborShift(i, drag.from, drag.to, hs[drag.from] + gap);
    return dy ? { transform: `translateY(${dy}px)` } : {};
  };

  return { listRef, grip, rowStyle, dragging: drag?.from ?? null };
}
