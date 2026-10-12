import { useCallback, useEffect, useState } from "react";
import { profileKey } from "./profile";

/*
 * Ширина и свёрнутость боковых панелей: левого меню и правой панели деталей.
 * Живёт в localStorage, как тема и внешний вид: нужна до первой отрисовки, чтобы окно не прыгало.
 */

export type PaneId = "side" | "det";
export interface Pane {
  width: number;
  collapsed: boolean;
}
export type Panes = Record<PaneId, Pane>;

export const PANE_LIMITS: Record<PaneId, { min: number; max: number; def: number }> = {
  side: { min: 220, max: 380, def: 220 },
  det: { min: 340, max: 560, def: 340 },
};

const KEY = "inbox.panes";
const clamp = (id: PaneId, w: number) => Math.round(Math.max(PANE_LIMITS[id].min, Math.min(PANE_LIMITS[id].max, w)));

function load(): Panes {
  const out = {} as Panes;
  let saved: Partial<Record<PaneId, Partial<Pane>>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(profileKey(KEY)) ?? "{}");
  } catch {
    // нет сохранённого: берём ширину по умолчанию
  }
  for (const id of ["side", "det"] as PaneId[]) {
    const s = saved[id] ?? {};
    out[id] = { width: clamp(id, typeof s.width === "number" ? s.width : PANE_LIMITS[id].def), collapsed: s.collapsed === true };
  }
  return out;
}

export function usePanes() {
  const [panes, setPanes] = useState<Panes>(load);
  useEffect(() => {
    try {
      localStorage.setItem(profileKey(KEY), JSON.stringify(panes));
    } catch {
      // без localStorage ширина просто не переживёт перезапуск
    }
  }, [panes]);
  const setWidth = useCallback((id: PaneId, w: number) => setPanes((p) => ({ ...p, [id]: { width: clamp(id, w), collapsed: false } })), []);
  const toggle = useCallback((id: PaneId, collapsed?: boolean) =>
    setPanes((p) => ({ ...p, [id]: { ...p[id], collapsed: collapsed ?? !p[id].collapsed } })), []);
  const reset = useCallback((id: PaneId) => setPanes((p) => ({ ...p, [id]: { width: PANE_LIMITS[id].def, collapsed: false } })), []);
  return { panes, setWidth, toggle, reset };
}
