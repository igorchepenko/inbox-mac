import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import type { Project, Task } from "./db";
import * as db from "./db";
import { parseDay, today } from "./dates";
import { Icon } from "./icons";
import {
  byDayOrder, DEFAULT_LEN, itemsFor, label, layoutDay, movable, rangeFor, shiftAnchor, snap, STEP, titleFor, toHHMM, WEEKDAYS,
  type CalMode, type Item, type Placed,
} from "./calendar";
import "./calendar.css";
import { PriorityIcon } from "./priority";

type Patch = Parameters<typeof db.updateTask>[1];

const HOUR = 48; // высота часа, px
const PX = HOUR / 60;
const DAY_END = 24 * 60;
const MONTH_CHIPS = 4; // сколько плашек помещается в ячейку месяца, остальное «ещё N»

/** Где задача окажется после перетаскивания */
interface Spot {
  day: string;
  start: number | null; // null — без времени, на весь день
  end: number | null;
}

interface Drag {
  item: Item;
  kind: "move" | "start" | "end";
  x0: number;
  y0: number;
  grab: number; // за какую минуту плашки взялись, чтобы она не прыгала под курсор
  active: boolean; // сдвинули дальше порога: это перетаскивание, а не клик
  spot: Spot;
  x: number;
  y: number;
}

const loadPref = <T extends string>(key: string, ok: readonly T[], def: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && ok.includes(v) ? v : def;
  } catch {
    return def;
  }
};

export default function CalendarView(props: {
  tasks: Task[];
  projects: Project[];
  selected: number | null;
  onSelect: (id: number) => void;
  onToggle: (task: Task) => void;
  onMove: (id: number, patch: Patch) => void;
  onCreate: (day: string, start: number | null, end: number | null) => void;
}) {
  const [mode, setModeState] = useState<CalMode>(() => loadPref("cal:mode", ["day", "week", "month"] as const, "week"));
  const [anchor, setAnchor] = useState(today());
  const [drag, setDrag] = useState<Drag | null>(null);
  // Куда задачу уже поставили, пока база сохраняет: чтобы плашка не прыгала назад на мгновение
  const [pending, setPending] = useState<Record<string, Spot>>({});
  const [landed, setLanded] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  // Пустое место под курсором: там появится новая задача по клику
  const [hover, setHover] = useState<{ day: string; start: number } | null>(null);
  const press = useRef<{ x: number; y: number } | null>(null);

  const setMode = (m: CalMode) => {
    setModeState(m);
    try {
      localStorage.setItem("cal:mode", m);
    } catch { /* не страшно, просто не запомнится */ }
  };

  useEffect(() => setPending({}), [props.tasks]);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const days = useMemo(() => rangeFor(mode, anchor), [mode, anchor]);
  const items = useMemo(() => {
    const all = itemsFor(props.tasks, days);
    return all.map((it) => (pending[it.key] ? { ...it, ...pending[it.key] } : it));
  }, [props.tasks, days, pending]);
  const project = (t: Task) => props.projects.find((p) => p.id === t.project_id);
  const openDay = (d: string) => {
    setAnchor(d);
    setMode("day");
  };

  // Клавиши календаря: ← → листают, D W M меняют вид. e.code не зависит от раскладки
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".overlay")) return;
      if (e.code === "ArrowLeft") setAnchor((a) => shiftAnchor(mode, a, -1));
      else if (e.code === "ArrowRight") setAnchor((a) => shiftAnchor(mode, a, 1));
      else if (e.code === "KeyD") setMode("day");
      else if (e.code === "KeyW") setMode("week");
      else if (e.code === "KeyM") setMode("month");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Геометрия для перетаскивания
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const alldayRef = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const locate = (x: number, y: number): { day: string; min: number | null } | null => {
    if (mode === "month") {
      const r = monthRef.current?.getBoundingClientRect();
      if (!r) return null;
      const col = clamp(Math.floor(((x - r.left) / r.width) * 7), 0, 6);
      const row = clamp(Math.floor(((y - r.top) / r.height) * 6), 0, 5);
      return { day: days[row * 7 + col], min: null };
    }
    const r = colsRef.current?.getBoundingClientRect();
    const sc = scrollRef.current?.getBoundingClientRect();
    if (!r || !sc) return null;
    const day = days[clamp(Math.floor(((x - r.left) / r.width) * days.length), 0, days.length - 1)];
    if (y < sc.top) return { day, min: null }; // выше сетки часов — строка «весь день»
    return { day, min: clamp((y - r.top) / PX, 0, DAY_END) };
  };

  const spotFor = (d: Drag, x: number, y: number): Spot => {
    const it = d.item;
    const at = locate(x, y);
    if (!at) return d.spot;
    if (mode === "month") return { day: at.day, start: it.start, end: it.end };
    if (d.kind === "end") return { day: it.day, start: it.start, end: clamp(snap(at.min ?? it.end!), it.start! + STEP, DAY_END) };
    if (d.kind === "start") return { day: it.day, start: clamp(snap(at.min ?? it.start!), 0, it.end! - STEP), end: it.end };
    if (at.min == null) return { day: at.day, start: null, end: null };
    if (it.start != null) {
      const len = it.end! - it.start;
      const s = clamp(snap(at.min - d.grab), 0, DAY_END - len);
      return { day: at.day, start: s, end: s + len };
    }
    // Задачу без времени бросили в сетку часов: час с того места, куда указывает курсор
    const s = clamp(Math.floor(at.min / STEP) * STEP, 0, DAY_END - 60);
    return { day: at.day, start: s, end: s + 60 };
  };

  const begin = (e: React.PointerEvent, item: Item, kind: Drag["kind"]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    press.current = null;
    const at = locate(e.clientX, e.clientY);
    const d: Drag = {
      item, kind, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false,
      grab: at?.min != null && item.start != null ? at.min - item.start : 0,
      spot: { day: item.day, start: item.start, end: item.end },
    };
    if (!movable(item)) d.kind = "move";
    dragRef.current = d;
    setDrag(d);
  };

  // Пока тянем: следим за курсором на всём окне и подкручиваем сетку у краёв
  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const update = () => {
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, spot: spotFor(d, d.x, d.y) };
      dragRef.current = next;
      setDrag(next);
    };
    const tick = () => {
      const d = dragRef.current, sc = scrollRef.current;
      if (d?.active && sc && mode !== "month") {
        const r = sc.getBoundingClientRect();
        const dy = d.y < r.top + 28 && d.y > r.top - 4 ? -10 : d.y > r.bottom - 28 ? 10 : 0;
        if (dy) {
          sc.scrollTop += dy;
          update();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const active = d.active || (movable(d.item) && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 4);
      dragRef.current = { ...d, x: e.clientX, y: e.clientY, active };
      if (active) update();
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      if (!d.active) return props.onSelect(d.item.task.id);
      const p = patchFor(d.item, d.spot, d.kind, mode);
      if (!p) return;
      setPending((m) => ({ ...m, [d.item.key]: d.spot }));
      setLanded(d.item.key);
      props.onMove(d.item.task.id, p);
      props.onSelect(d.item.task.id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [drag != null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!landed) return;
    const id = setTimeout(() => setLanded(null), 400);
    return () => clearTimeout(id);
  }, [landed]);

  // Сетку часов открываем на начале рабочего дня или на первой задаче, если она раньше
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const first = Math.min(8 * 60, ...items.filter((i) => i.start != null).map((i) => i.start!));
    sc.scrollTop = Math.max(0, (first - 30) * PX);
  }, [mode, days[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Начало новой задачи под курсором: с шагом 15 минут, полчаса должны влезть до конца дня */
  const newStart = (y: number) => {
    const r = colsRef.current?.getBoundingClientRect();
    return r ? clamp(Math.floor((y - r.top) / PX / STEP) * STEP, 0, DAY_END - DEFAULT_LEN) : 0;
  };
  // Клик по пустому месту создаёт задачу. Клик, а не конец перетаскивания: курсор почти не сдвинулся
  const emptyDown = (e: React.PointerEvent) => {
    press.current = e.button === 0 && e.target === e.currentTarget ? { x: e.clientX, y: e.clientY } : null;
  };
  const emptyUp = (e: React.PointerEvent, day: string, timed: boolean) => {
    const p = press.current;
    press.current = null;
    if (!p || e.target !== e.currentTarget || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) return;
    const s = timed ? newStart(e.clientY) : null;
    setHover(null);
    props.onCreate(day, s, s == null ? null : s + DEFAULT_LEN);
  };

  const t = today();
  const moving = drag?.active ? drag : null;
  const openCount = items.filter((i) => !i.done && !i.virtual).length;

  const chip = (it: Item, extra = "") => {
    const p = project(it.task);
    const isMoving = moving?.item.key === it.key;
    const cls = ["cal-chip", extra, chipClass(it, props.selected), isMoving && "origin", landed === it.key && "landed"].filter(Boolean).join(" ");
    return (
      <div key={it.key} className={cls} style={accent(p?.color)} title={tip(it, p)} data-task-id={it.virtual ? undefined : it.task.id}
        onPointerDown={(e) => begin(e, it, "move")} onDoubleClick={(e) => e.stopPropagation()}>
        <Check it={it} onToggle={props.onToggle} />
        {it.start != null && <span className="cal-chip-time">{label(it.start)}</span>}
        {it.task.priority > 0 && !it.done && <PriorityIcon p={it.task.priority} size={12} />}
        <span className="cal-chip-t">{it.task.title}</span>
        {it.virtual && <Repeat size={11} className="cal-rep" />}
      </div>
    );
  };

  const event = (it: Placed, ghost = false) => {
    const p = project(it.task);
    const h = Math.max((it.end! - it.start!) * PX, STEP * PX) - 2;
    const isMoving = !ghost && moving?.item.key === it.key;
    const cls = ["cal-ev", chipClass(it, props.selected), ghost && "dragging", isMoving && "origin", h < 30 && "short", h >= 30 && h < 60 && "compact",
      landed === it.key && "landed"].filter(Boolean).join(" ");
    const style: CSSProperties = {
      ...accent(p?.color),
      top: it.start! * PX + 1,
      height: h,
      // Раскладка как в Google Календаре: поздняя задача поверх ранней со сдвигом, одновременные рядом (calendar.ts)
      left: `calc(${it.left * 100}% + 2px)`,
      width: `calc(${it.width * 100}% - 4px)`,
      ["--z" as string]: it.z,
    };
    const canResize = movable(it) && !ghost;
    return (
      <div key={ghost ? "drag" : it.key} className={cls} style={style} title={ghost ? undefined : tip(it, p)}
        data-task-id={ghost || it.virtual ? undefined : it.task.id}
        onPointerDown={ghost ? undefined : (e) => begin(e, it, "move")}>
        {canResize && h >= 30 && <div className="cal-grip top" onPointerDown={(e) => begin(e, it, "start")} />}
        <div className="cal-ev-head">
          <Check it={it} onToggle={props.onToggle} />
          {it.task.priority > 0 && !it.done && <PriorityIcon p={it.task.priority} size={12} />}
          <span className="cal-ev-t">{it.task.title}</span>
          {it.virtual && <Repeat size={11} className="cal-rep" />}
        </div>
        {h >= 30 && <span className="cal-ev-time">{label(it.start!)}<span className="cal-ev-rest">–{label(it.end!)}{p ? ` · ${p.name}` : ""}</span></span>}
        {canResize && <div className="cal-grip bottom" onPointerDown={(e) => begin(e, it, "end")} />}
      </div>
    );
  };

  // Где сейчас перетаскиваемая плашка
  const ghostCol = moving && mode !== "month" && moving.spot.start != null ? days.indexOf(moving.spot.day) : -1;

  return (
    <main className={`main cal-main ${moving ? "is-dragging" : ""}`}>
      <header className="head" data-tauri-drag-region>
        <span className="head-icon" style={{ color: "var(--stand)" }}><Icon name="schedule" size={24} /></span>
        <div className="head-text">
          <h2>{titleFor(mode, anchor)}</h2>
          <p>{openCount ? `Открытых задач: ${openCount}` : "Ничего не запланировано"}</p>
        </div>
        <div className="cal-tools">
          <div className="cal-stepper">
            <button className="cal-nav" title="Назад (←)" onClick={() => setAnchor(shiftAnchor(mode, anchor, -1))}><ChevronLeft size={16} /></button>
            <button className="cal-today" onClick={() => setAnchor(t)}>Сегодня</button>
            <button className="cal-nav" title="Вперёд (→)" onClick={() => setAnchor(shiftAnchor(mode, anchor, 1))}><ChevronRight size={16} /></button>
          </div>
          <div className="cal-modes" role="tablist">
            {(["day", "week", "month"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}
                title={`Клавиша ${m === "day" ? "D" : m === "week" ? "W" : "M"}`}>
                {m === "day" ? "День" : m === "week" ? "Неделя" : "Месяц"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {mode === "month" ? (
        <div className="cal-month">
          <div className="cal-month-wd">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="cal-month-grid" ref={monthRef}>
            {days.map((d) => {
              const its = items.filter((i) => i.day === d).sort(byDayOrder);
              const other = parseDay(d).getMonth() !== parseDay(anchor).getMonth();
              const target = moving?.spot.day === d && moving.item.day !== d;
              const shown = its.length > MONTH_CHIPS ? its.slice(0, MONTH_CHIPS - 1) : its;
              return (
                <div key={d} className={`cal-cell ${other ? "other" : ""} ${d === t ? "today" : ""} ${target ? "target" : ""}`}
                  title={moving ? undefined : "Клик по пустому месту — новая задача на этот день"}
                  onPointerDown={emptyDown} onPointerUp={(e) => emptyUp(e, d, false)}>
                  <button className="cal-cell-n" onClick={() => openDay(d)}>{parseDay(d).getDate()}</button>
                  {shown.map((it) => chip(it))}
                  {its.length > shown.length && (
                    <button className="cal-more" onClick={() => openDay(d)}>ещё {its.length - shown.length}</button>
                  )}
                </div>
              );
            })}
          </div>
          {moving && (
            <div className={`cal-chip floating ${chipClass(moving.item, null)}`} style={{ ...accent(project(moving.item.task)?.color), left: moving.x, top: moving.y }}>
              <Check it={moving.item} onToggle={() => {}} />
              <span className="cal-chip-t">{moving.item.task.title}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="cal-time" style={{ "--n": days.length } as CSSProperties}>
          <div className="cal-days">
            <span className="cal-gutter" />
            {days.map((d) => {
              const dt = parseDay(d);
              return (
                <button key={d} className={`cal-dayhead ${d === t ? "today" : ""} ${d < t ? "past" : ""}`} onClick={() => openDay(d)}
                  disabled={mode === "day"}>
                  <span className="wd">{WEEKDAYS[(dt.getDay() + 6) % 7]}</span>
                  <span className="dn">{dt.getDate()}</span>
                </button>
              );
            })}
          </div>
          <div className="cal-allday">
            <span className="cal-gutter">весь день</span>
            <div className="cal-allday-cols" ref={alldayRef}>
              {days.map((d) => {
                const its = items.filter((i) => i.day === d && i.start == null).sort(byDayOrder);
                const target = moving?.spot.day === d && moving.spot.start == null;
                return (
                  <div key={d} className={`cal-allday-col ${target ? "target" : ""}`}
                    onPointerDown={emptyDown} onPointerUp={(e) => emptyUp(e, d, false)}>
                    {its.map((it) => chip(it))}
                    {target && moving.item.start != null && (
                      <div className={`cal-chip dragging ${chipClass(moving.item, null)}`} style={accent(project(moving.item.task)?.color)}>
                        <span className="cal-chip-t">{moving.item.task.title}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="cal-scroll" ref={scrollRef}>
            <div className="cal-grid-body" style={{ height: 24 * HOUR }}>
              <div className="cal-hours">
                {Array.from({ length: 23 }, (_, h) => <span key={h} style={{ top: (h + 1) * HOUR }}>{String(h + 1).padStart(2, "0")}:00</span>)}
              </div>
              <div className="cal-cols" ref={colsRef}>
                {days.map((d) => {
                  const placed = layoutDay(items.filter((i) => i.day === d));
                  return (
                    <div key={d} className={`cal-col ${d === t ? "today" : ""}`}
                      onPointerDown={emptyDown} onPointerUp={(e) => emptyUp(e, d, true)}
                      onPointerMove={(e) => {
                        const s = !drag && e.target === e.currentTarget ? newStart(e.clientY) : null;
                        if (s == null) return hover && setHover(null);
                        if (hover?.day !== d || hover.start !== s) setHover({ day: d, start: s });
                      }}
                      onPointerLeave={() => setHover(null)}>
                      {hover?.day === d && !drag && (
                        <div className="cal-new" style={{ top: hover.start * PX + 1, height: DEFAULT_LEN * PX - 2 }}>
                          + {label(hover.start)}
                        </div>
                      )}
                      {placed.map((it) => event(it))}
                      {d === t && <div className="cal-now" style={{ top: (now.getHours() * 60 + now.getMinutes()) * PX }} />}
                    </div>
                  );
                })}
                {ghostCol >= 0 && moving && (
                  <div className="cal-drag-layer" style={{ left: `${(ghostCol / days.length) * 100}%`, width: `${100 / days.length}%` }}>
                    {event({ ...moving.item, ...moving.spot, left: 0, width: 1, z: 1 }, true)}
                    <span className="cal-drag-label" style={{ top: moving.spot.start! * PX }}>
                      {label(moving.spot.start!)}–{label(moving.spot.end!)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** Изменения задачи после перетаскивания. null — ничего не поменялось */
function patchFor(it: Item, to: Spot, kind: Drag["kind"], mode: CalMode): Patch | null {
  const x = it.task;
  if (kind !== "move" && to.start === it.start && to.end === it.end) return null;
  const p: Patch = {};
  if (to.day !== x.due_date) p.due_date = to.day;
  if (mode !== "month") {
    if (to.start == null) {
      if (x.start_time) Object.assign(p, { start_time: null, end_time: null });
    } else {
      const st = toHHMM(to.start);
      if (st !== x.start_time) p.start_time = st;
      // Задача без конца после переноса остаётся без конца; растягивание конец задаёт
      const et = kind === "move" && x.start_time && !x.end_time ? null : toHHMM(to.end!);
      if (et !== x.end_time) p.end_time = et;
    }
  }
  // Напоминание едет вместе с задачей. Если оно стояло на начало, то и остаётся на начале
  if (x.remind_at && (p.due_date || p.start_time !== undefined)) {
    let rt = x.remind_at.slice(11, 16);
    if (x.start_time && rt === x.start_time && to.start != null && mode !== "month") rt = toHHMM(to.start);
    const r = `${to.day}T${rt}`;
    if (r !== x.remind_at) Object.assign(p, { remind_at: r, reminded: 0 });
  }
  return Object.keys(p).length ? p : null;
}

function Check({ it, onToggle }: { it: Item; onToggle: (t: Task) => void }) {
  const locked = it.virtual || it.task.status === "archived";
  return (
    <button className="cal-chk" disabled={locked} title={it.virtual ? "Будущий повтор" : it.done ? "Вернуть" : "Сделано"}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), !locked && onToggle(it.task))} />
  );
}

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const accent = (color?: string): CSSProperties => ({ "--c": `var(--${color ?? "stand"})` }) as CSSProperties;

function chipClass(it: Item, selected: number | null): string {
  return [
    it.done && "done",
    it.virtual && "virtual",
    !movable(it) && "locked",
    !it.virtual && it.task.id === selected && "sel",
    it.task.priority >= 4 && !it.done && "high",
    !it.done && !it.virtual && it.day < today() && "overdue",
  ].filter(Boolean).join(" ");
}

function tip(it: Item, p?: Project): string {
  const parts = [it.task.title];
  if (it.start != null) parts.push(`${label(it.start)}–${label(it.end!)}`);
  if (p) parts.push(p.name);
  if (it.virtual) parts.push("будущий повтор, переносится ближайший");
  return parts.join(" · ");
}

