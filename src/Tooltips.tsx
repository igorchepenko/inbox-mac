import { useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * Подсказки при наведении для всего окна. Элементу достаточно атрибутов:
 * data-tip="Настройки" и, если есть сочетание, data-key="⌘,". Системный title в WebView появляется
 * больше чем через секунду и не умеет показывать клавиши, поэтому рисуем свои; обычный title тоже
 * перехватывается и показывается так же.
 *
 * Два вида подсказок:
 *  - полный текст (обрезанное описание, ссылка, пункт чеклиста): появляется сразу. Это элемент
 *    с data-tip-full, ссылка <a> или элемент, текст которого сейчас обрезан многоточием;
 *  - пояснение к кнопке: с короткой паузой, чтобы при движении мыши по меню подсказки не мелькали.
 * Если текст элемента виден целиком и совпадает с подсказкой, подсказка не нужна и не показывается.
 */
interface Tip {
  text: string;
  keys?: string;
  x: number;
  y: number;
  below: boolean;
}

const HINT_DELAY = 300;

const clipped = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;

/** title превращаем в data-tip, иначе поверх нашей подсказки через секунду вылезет системная */
function adoptTitle(el: HTMLElement) {
  const t = el.getAttribute("title");
  if (t == null) return;
  if (t && !el.dataset.tip) el.dataset.tip = t;
  el.removeAttribute("title");
}

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
      const target = e.target as HTMLElement | null;
      const titled = target?.closest<HTMLElement>("[title]");
      if (titled) adoptTitle(titled);
      const el = target?.closest<HTMLElement>("[data-tip]") ?? null;
      if (el === current) return;
      hide();
      if (!el || !el.dataset.tip) return;
      const cut = clipped(el);
      const full = el.dataset.tipFull != null || el.tagName === "A" || cut;
      if (!cut && el.textContent?.trim() === el.dataset.tip.trim()) return;
      current = el;
      const show = () => {
        if (!current?.isConnected) return;
        const r = current.getBoundingClientRect();
        const below = window.innerHeight - r.bottom > Math.min(160, r.top);
        setTip({ text: current.dataset.tip!, keys: current.dataset.key, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
      };
      if (full) show();
      else timer = window.setTimeout(show, HINT_DELAY);
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
