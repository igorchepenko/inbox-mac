import { useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * Подсказки при наведении для всего окна. Элементу достаточно атрибутов:
 * data-tip="Настройки" и, если есть сочетание, data-key="⌘,". Системный title в WebView появляется
 * больше чем через секунду и не умеет показывать клавиши, поэтому рисуем свои.
 */
interface Tip {
  text: string;
  keys?: string;
  x: number;
  y: number;
  below: boolean;
}

const DELAY = 450;

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]") ?? null;
      if (el === current) return;
      hide();
      if (!el || !el.dataset.tip) return;
      current = el;
      timer = window.setTimeout(() => {
        if (!current?.isConnected) return;
        const r = current.getBoundingClientRect();
        const below = r.bottom + 40 < window.innerHeight;
        setTip({ text: current.dataset.tip!, keys: current.dataset.key, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
      }, DELAY);
    };
    const leave = (e: PointerEvent) => !e.relatedTarget && hide();
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", leave);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    return () => {
      hide();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);
  // Центрируем под элементом, но не даём подсказке вылезти за край окна
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    el.style.left = `${Math.max(8, Math.min(tip.x - w / 2, window.innerWidth - w - 8))}px`;
    el.style.visibility = "visible";
  }, [tip]);
  if (!tip) return null;
  return (
    <div ref={box} className={`tip ${tip.below ? "below" : "above"}`} role="tooltip" style={{ top: tip.y, visibility: "hidden" }}>
      <span>{tip.text}</span>
      {tip.keys && <kbd>{tip.keys}</kbd>}
    </div>
  );
}
