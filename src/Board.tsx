import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { spaceVars } from "./palette";
import { Bell, CalendarDays, Check, Clock, Columns3, Grid2x2, Link2, List, ListChecks, Paperclip, Repeat } from "lucide-react";
import type { Project, Task } from "./db";
import { addDays, fmtDay, nextMonday, today } from "./dates";
import { TARGETS, type BoardColumn, type Layout, type Stage } from "./boardOps";
import * as board from "./boardOps";
import { plural, SORTS, type SortBy } from "./views";
import { PRIORITY } from "./components";
import { Icon } from "./icons";
import { Calendar, Popover } from "./widgets";
import { fmtRange, QuadrantGlyph } from "./extras";
import "./board.css";
import { PriorityIcon } from "./priority";

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(.2, .8, .2, 1)";

/** Переключатель вида списка в шапке */
export function LayoutSwitch({ value, onChange }: { value: Layout; onChange: (l: Layout) => void }) {
  const opts: [Layout, string, ReactNode][] = [
    ["list", "Списком", <List size={14} />],
    ["board", "Канбан", <Columns3 size={14} />],
  ];
  return (
    <div className="theme-switch layout-switch" role="radiogroup" aria-label="Вид">
      {opts.map(([id, name, icon]) => (
        <button key={id} role="radio" aria-checked={value === id} title={name} className={value === id ? "on" : ""}
          onClick={() => onChange(id)}>{icon}</button>
      ))}
    </div>
  );
}

/** Сортировка списка и столбцов канбана: по дате, по важности, по матрице */
export function SortSwitch({ value, onChange }: { value: SortBy; onChange: (s: SortBy) => void }) {
  const icons: Record<SortBy, ReactNode> = {
    date: <CalendarDays size={14} />,
    priority: <PriorityIcon p={5} size={14} color="currentColor" />,
    matrix: <Grid2x2 size={14} />,
  };
  return (
    <div className="theme-switch layout-switch" role="radiogroup" aria-label="Сортировка">
      {SORTS.map((s) => (
        <button key={s.id} role="radio" aria-checked={value === s.id} aria-label={s.name} data-tip={s.hint}
          className={value === s.id ? "on" : ""} onClick={() => onChange(s.id)}>{icons[s.id]}</button>
      ))}
    </div>
  );
}

/** Как пользователь выбрал задачу: обычный клик, ⌘ добавляет к выделению, ⇧ выделяет диапазон */
export type Pick = (id: number, mods: { meta: boolean; shift: boolean }) => void;
const mods = (e: React.MouseEvent | MouseEvent) => ({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey });

/** Подписи под названием: дата, время, напоминание, проект, чеклист, ссылки, файлы */
function Meta({ task: x, project }: { task: Task; project?: Project }) {
  const done = x.status === "done" || x.status === "archived";
  const overdue = x.status === "active" && !!x.due_date && x.due_date < today();
  const checked = x.subtasks.filter((s) => s.done).length;
  return (
    <div className="card-meta">
      {x.due_date && <span className={`meta ${overdue ? "overdue" : ""}`}><CalendarDays size={11} /> {fmtDay(x.due_date)}</span>}
      {x.start_time && <span className="meta"><Clock size={11} /> {fmtRange(x.start_time, x.end_time)}</span>}
      {x.remind_at && !x.reminded && !done && <span className="meta"><Bell size={11} /> {x.remind_at.slice(11, 16)}</span>}
      {x.subtasks.length > 0 && <span className="meta"><ListChecks size={11} /> {checked}/{x.subtasks.length}</span>}
      {x.links.length > 0 && <span className="meta"><Link2 size={11} /> {x.links.length}</span>}
      {x.files.length > 0 && <span className="meta"><Paperclip size={11} /> {x.files.length}</span>}
      {x.recurrence && !done && <span className="meta" title="Повторяется"><Repeat size={11} /></span>}
      {x.quadrant && !done && <QuadrantGlyph q={x.quadrant} />}
      {project && <span className="tag" style={{ background: `var(--${project.color})`, color: `var(--${project.color}-ink, var(--on-acc))` }}>{project.name}</span>}
    </div>
  );
}

function hasMeta(x: Task, project?: Project) {
  return !!(x.due_date || x.start_time || x.remind_at || x.recurrence || x.quadrant || x.subtasks.length || x.links.length || x.files.length || project);
}

/**
 * Плавная перестановка (FLIP): до обновления запоминаем, где стояли карточки, после него
 * сдвигаем каждую обратно и отпускаем анимацией на новое место.
 */
function useFlip(root: React.RefObject<HTMLElement | null>, key: string) {
  const last = useRef(key);
  const before = useRef<Map<string, DOMRect> | null>(null);
  // Замер в теле рендера: DOM ещё показывает прошлое состояние
  if (last.current !== key && root.current && !before.current) {
    before.current = new Map();
    root.current.querySelectorAll<HTMLElement>("[data-card]").forEach((el) => before.current!.set(el.dataset.card!, el.getBoundingClientRect()));
  }
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    last.current = key;
    if (!prev || !root.current || reduceMotion()) return;
    root.current.querySelectorAll<HTMLElement>("[data-card]").forEach((el) => {
      const a = prev.get(el.dataset.card!);
      if (!a || el.classList.contains("landing")) return;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing: EASE });
    });
  }, [key, root]);
}

interface Drag {
  ids: number[];
  from: Stage;
  over: Stage | null;
}

/** Канбан по этапам: перенос карточки в столбец меняет этап задачи */
export function BoardView(props: {
  columns: BoardColumn[];
  projects: Project[];
  sel: number | null;
  picked: number[];
  fileDrop: number | null; // над какой карточкой держат файлы из Finder
  onPick: Pick;
  onToggle: (x: Task) => void;
  onMove: (ids: number[], col: Stage) => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const colRefs = useRef(new Map<Stage, HTMLElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const key = props.columns.map((c) => `${c.key}:${c.items.map((i) => `${i.task.id}.${i.task.status}`).join(",")}`).join("|");
  useFlip(root, key);

  // Выбранная карточка не уходит из вида при ходьбе стрелками
  useEffect(() => {
    root.current?.querySelector(`[data-card="${props.sel}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.sel]);

  const start = (e: React.PointerEvent<HTMLElement>, x: Task, from: Stage) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = e.currentTarget;
    const x0 = e.clientX, y0 = e.clientY;
    const r = el.getBoundingClientRect();
    const offX = x0 - r.left, offY = y0 - r.top;
    let ghost: HTMLElement | null = null;
    let over: Stage | null = null;
    let announced = false;
    let ids: number[] = [];

    const overAt = (cx: number, cy: number): Stage | null => {
      for (const [col, c] of colRefs.current) {
        const b = c.getBoundingClientRect();
        if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) return col;
      }
      return null;
    };
    const move = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        // Тянем всю выделенную группу, если карточка в ней, иначе одну
        ids = props.picked.includes(x.id) ? props.picked : [x.id];
        ghost = el.cloneNode(true) as HTMLElement;
        ghost.classList.add("drag-ghost");
        ghost.classList.remove("sel");
        ghost.style.width = `${r.width}px`;
        if (ids.length > 1) {
          const badge = document.createElement("span");
          badge.className = "drag-count";
          badge.textContent = String(ids.length);
          ghost.appendChild(badge);
        }
        document.body.appendChild(ghost);
        document.body.classList.add("dragging");
      }
      ghost.style.transform = `translate(${ev.clientX - offX}px, ${ev.clientY - offY}px) rotate(2deg) scale(1.03)`;
      const o = overAt(ev.clientX, ev.clientY);
      if (o !== over || !announced) {
        announced = true;
        over = o;
        setDrag({ ids, from, over: o });
      }
      // У края доски прокручиваем её, чтобы дотянуть до дальнего столбца
      const b = root.current?.getBoundingClientRect();
      if (b && root.current) {
        if (ev.clientX > b.right - 40) root.current.scrollLeft += 14;
        else if (ev.clientX < b.left + 40) root.current.scrollLeft -= 14;
      }
    };
    const up = async (ev: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      if (!ghost) {
        props.onPick(x.id, mods(ev));
        return;
      }
      const g = ghost;
      document.body.classList.remove("dragging");
      const target = over && over !== from ? over : null;
      if (target) await props.onMove(ids, target);
      setDrag(null);
      // Ждём, пока React дорисует доску с новыми данными
      await new Promise((r) => setTimeout(r, 0));
      // Призрак плавно садится на новое место карточки или возвращается на старое
      requestAnimationFrame(() => {
        const dest = root.current?.querySelector<HTMLElement>(`[data-card="${x.id}"]`);
        if (!dest || reduceMotion()) return g.remove();
        dest.classList.add("landing");
        const d = dest.getBoundingClientRect();
        const anim = g.animate(
          [{ transform: g.style.transform }, { transform: `translate(${d.left}px, ${d.top}px) rotate(0) scale(1)` }],
          { duration: 240, easing: EASE, fill: "forwards" },
        );
        anim.onfinish = () => {
          dest.classList.remove("landing");
          g.remove();
        };
      });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
  };

  return (
    <div className="board" ref={root}>
      {props.columns.map(({ key: col, name, accent, icon, hint, items }) => {
        const open = items.filter((i) => i.task.status === "inbox" || i.task.status === "active").length;
        const isOver = drag?.over === col && drag.from !== col;
        return (
          <section key={col} ref={(el) => void (el ? colRefs.current.set(col, el) : colRefs.current.delete(col))}
            className={`col ${isOver ? "over" : ""}`} style={{ "--c": `var(--${accent})` } as React.CSSProperties}>
            <header className="col-head">
              <span className="col-icon"><Icon name={icon} size={14} /></span>
              <span className="col-name">{name}</span>
              <span className="col-n">{open || items.length || ""}</span>
            </header>
            <div className="col-body">
              {isOver && <div className="col-hint">{hint}</div>}
              {items.map(({ task: x, group }) => {
                const project = props.projects.find((p) => p.id === x.project_id);
                const done = x.status === "done" || x.status === "archived";
                const lifted = drag?.ids.includes(x.id);
                return (
                  <div key={x.id}>
                    {group && <div className="group col-group">{group}</div>}
                    <article data-card={x.id} data-task-id={x.id} onPointerDown={(e) => start(e, x, col)}
                      className={`kcard ${props.sel === x.id ? "sel" : ""} ${props.fileDrop === x.id ? "filedrop" : ""} ${props.picked.includes(x.id) ? "picked" : ""} ${done ? "done" : ""} ${lifted ? "lifted" : ""} ${project ? "pc" : ""}`}
                      style={spaceVars(project?.color)}>
                      <div className="kcard-top">
                        <button className="chk kchk" aria-label={done ? "Вернуть" : "Сделано"} disabled={x.status === "archived"}
                          onClick={(e) => (e.stopPropagation(), props.onToggle(x))}><Check size={11} strokeWidth={3.2} /></button>
                        <span className="t">{x.title}</span>
                        {x.priority > 0 && !done && <PriorityIcon p={x.priority} />}
                      </div>
                      {hasMeta(x, project) && <Meta task={x} project={project} />}
                    </article>
                  </div>
                );
              })}
              {!items.length && !isOver && <div className="col-empty">Пусто</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Правая панель, когда выделено несколько задач: всё, что можно сделать с ними разом */
export function BulkPanel(props: {
  tasks: Task[];
  total: number;
  projects: Project[];
  selecting: boolean;
  run: (fn: () => Promise<unknown>) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const xs = props.tasks;
  const [confirm, setConfirm] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const calBtn = useRef<HTMLButtonElement>(null);
  const t = today();
  const inbox = xs.filter((x) => x.status === "inbox").length;
  const open = xs.filter((x) => x.status === "inbox" || x.status === "active").length;
  const closed = xs.filter((x) => x.status === "done" || x.status === "archived").length;
  const editable = xs.some((x) => x.status !== "archived");
  const all = <T,>(get: (x: Task) => T) => (xs.length && xs.every((x) => get(x) === get(xs[0])) ? get(xs[0]) : undefined);
  const date = all((x) => x.due_date), project = all((x) => x.project_id), priority = all((x) => x.priority);
  const go = (fn: (xs: Task[]) => Promise<void>) => props.run(() => fn(xs));
  const chip = (on: boolean, accent: string, onClick: () => void, label: ReactNode, key?: string | number) => (
    <button key={key} type="button" className={`chip ${on ? "on" : ""}`} style={on ? { background: `var(--${accent})` } : undefined}
      onClick={onClick}>{label}</button>
  );
  const dates = [t, addDays(t, 1), nextMonday()].filter((d, i, a) => a.indexOf(d) === i);

  return (
    <aside className="det bulk">
      <div>
        <div className="lbl">Выбрано</div>
        <div className="bulk-title">{xs.length ? plural(xs.length, "задача", "задачи", "задач") : "Ничего"}</div>
        <div className="hint">
          {xs.length ? "⌘-клик добавляет или убирает задачу, ⇧-клик выделяет подряд." : "Кликай по задачам, чтобы выбрать их."}
        </div>
      </div>

      {inbox > 0 && (
        <div className="det-sec">
          <button className="cta" onClick={() => go(board.bulkTriage)}>Разобрать {inbox > 1 ? `все ${inbox}` : ""}</button>
        </div>
      )}

      <fieldset className="det-sec" disabled={!editable}>
        <div className="lbl">Дата</div>
        <div className="seg">
          {dates.map((d) => chip(date === d, "stand", () => go((xs) => board.bulkDate(xs, d)), fmtDay(d), d))}
          <button type="button" ref={calBtn} className="chip" onClick={() => setCalOpen((o) => !o)}>
            <CalendarDays size={13} /> Другая
          </button>
          {calOpen && (
            <Popover anchor={calBtn.current} onClose={() => setCalOpen(false)} width={260}>
              <Calendar value={date ?? null} onPick={(d) => (setCalOpen(false), go((xs) => board.bulkDate(xs, d)))} />
            </Popover>
          )}
          <button type="button" className="link" onClick={() => go((xs) => board.bulkDate(xs, null))}>без даты</button>
        </div>
      </fieldset>

      <fieldset className="det-sec" disabled={!editable}>
        <div className="lbl">Важность</div>
        <div className="seg">
          {PRIORITY.map((p) => chip(priority === p.value, p.accent, () => go((xs) => board.bulkPriority(xs, priority === p.value ? 0 : p.value)), <><PriorityIcon p={p.value} size={13} color={priority === p.value ? "currentColor" : undefined} /> {p.name}</>, p.value))}
        </div>
      </fieldset>

      <fieldset className="det-sec" disabled={!editable}>
        <div className="lbl">Пространство</div>
        <div className="seg">
          {props.projects.map((p) =>
            chip(project === p.id, p.color, () => go((xs) => board.bulkProject(xs, project === p.id ? null : p.id)), <><Icon name={p.icon} size={12} /> {p.name}</>, p.id))}
          {project !== null && xs.length > 0 && (
            <button type="button" className="link" onClick={() => go((xs) => board.bulkProject(xs, null))}>без пространства</button>
          )}
          {!props.projects.length && <span className="hint">Пространств пока нет</span>}
        </div>
      </fieldset>

      <div className="det-sec">
        <div className="lbl">Перенести</div>
        <div className="seg">
          {TARGETS.map((c) => (
            <button key={c.id} type="button" className="chip" onClick={() => go((xs) => board.bulkMove(xs, c.id))}>
              <span style={{ color: `var(--${c.accent})`, display: "inline-flex" }}><Icon name={c.icon} size={12} /></span> {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="det-actions">
        {open > 0 && <button className="cta go" onClick={() => go(board.bulkDone)}>Сделано{open > 1 ? `: ${open}` : ""}</button>}
        {closed > 0 && <button className="cta stand" onClick={() => go(board.bulkReopen)}>Вернуть в работу{closed > 1 ? `: ${closed}` : ""}</button>}
        <div className="row-btns">
          {xs.length < props.total && <button className="btn" onClick={props.onSelectAll}>Выбрать все ({props.total})</button>}
          <button className="btn" onClick={props.onClear}>{props.selecting ? "Готово" : "Снять"} <kbd>Esc</kbd></button>
        </div>
        {xs.length > 0 && (
          <button className={`link danger ${confirm ? "armed" : ""}`} onBlur={() => setConfirm(false)}
            onClick={() => (confirm ? (setConfirm(false), go(board.bulkDelete)) : setConfirm(true))}>
            {confirm ? `Точно удалить ${plural(xs.length, "задачу", "задачи", "задач")}? Нажми ещё раз` : "Удалить выбранные"}
          </button>
        )}
      </div>
    </aside>
  );
}
