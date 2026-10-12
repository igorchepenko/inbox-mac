import { useRef } from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import { PANE_LIMITS, type PaneId, type Panes } from "./panes";

/*
 * Каркас окна: ручки, за которые меняется ширина левого меню и правой панели, и кнопки,
 * сворачивающие их совсем. Ручка сидит на границе панели; двойной клик возвращает ширину по умолчанию.
 * Перетаскивание только меняет ширину и упирается в минимум: свернуть панель можно лишь кнопкой или сочетанием.
 */

const MAIN_MIN = 380;

interface Props {
  panes: Panes;
  hasDetails: boolean;
  onWidth: (id: PaneId, w: number) => void;
  onToggle: (id: PaneId, collapsed?: boolean) => void;
  onReset: (id: PaneId) => void;
}

export function Frame({ panes, hasDetails, onWidth, onToggle, onReset }: Props) {
  return (
    <>
      <button className="frame-btn frame-left" aria-pressed={!panes.side.collapsed}
        data-tip={panes.side.collapsed ? "Показать меню" : "Скрыть меню"} data-key="⌃⌘S" onClick={() => onToggle("side")}>
        <PanelLeft size={15} />
      </button>
      {hasDetails && (
        <button className="frame-btn frame-right" aria-pressed={!panes.det.collapsed}
          data-tip={panes.det.collapsed ? "Показать панель задачи" : "Скрыть панель задачи"} data-key="⌥⌘I" onClick={() => onToggle("det")}>
          <PanelRight size={15} />
        </button>
      )}
      {!panes.side.collapsed && <Handle id="side" panes={panes} onWidth={onWidth} onReset={onReset} />}
      {hasDetails && !panes.det.collapsed && <Handle id="det" panes={panes} onWidth={onWidth} onReset={onReset} />}
    </>
  );
}

function Handle({ id, panes, onWidth, onReset }: { id: PaneId; panes: Panes } & Pick<Props, "onWidth" | "onReset">) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const width = panes[id].width;
  const sign = id === "side" ? 1 : -1;
  return (
    <div className={`pane-handle pane-${id}`} role="separator" aria-orientation="vertical"
      aria-valuenow={width} aria-valuemin={PANE_LIMITS[id].min} aria-valuemax={PANE_LIMITS[id].max}
      style={id === "side" ? { left: width - 3 } : { right: width - 3 }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
        document.body.classList.add("pane-resizing");
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const w = d.w + sign * (e.clientX - d.x);
        // главной колонке оставляем не меньше MAIN_MIN, чтобы панели не съели список
        const other = id === "side" ? panes.det : panes.side;
        const room = window.innerWidth - (other.collapsed ? 0 : other.width) - MAIN_MIN;
        onWidth(id, Math.min(w, Math.max(PANE_LIMITS[id].min, room)));
      }}
      onPointerUp={() => {
        drag.current = null;
        document.body.classList.remove("pane-resizing");
      }}
      onPointerCancel={() => {
        drag.current = null;
        document.body.classList.remove("pane-resizing");
      }}
      onDoubleClick={() => onReset(id)} />
  );
}
