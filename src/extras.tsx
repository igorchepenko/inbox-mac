// Расширенные поля задачи: время «от–до», повтор, матрица Эйзенхауэра, чеклист, ссылки и файлы.
// Используются и в правой панели, и в форме записи задачи (⌥Space и N)
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, CalendarDays, FileText, FolderSearch, GripVertical, Link2, Paperclip, Pencil, Repeat, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import * as db from "./db";
import type { Task } from "./db";
import { addDays, fmtDay, nextMonday, parseDay, today } from "./dates";
import { anchorRule, describe, isoWeekday, nthLabel, parseRule, PRESETS, WD_SHORT, type Freq, type Rule } from "./recurrence";
import { Calendar, Popover, TimeInput, useAutosize } from "./widgets";
import { PRIORITY, PriorityIcon } from "./priority";

export type RunDb = (fn: () => Promise<unknown>) => void;

export function Chip(props: { on: boolean; accent: string; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" className={`chip ${props.on ? "on" : ""}`} title={props.title}
      style={props.on ? { background: `var(--${props.accent})` } : undefined} onClick={props.onClick}>{props.children}</button>
  );
}

/** Строка «подпись слева, поле справа» внутри блока */
export function Line(props: { label: string; children: ReactNode }) {
  return (
    <div className="line">
      <span className="line-lbl">{props.label}</span>
      <div className="seg">{props.children}</div>
    </div>
  );
}

// Дата

/**
 * Быстрые даты и «Другая» с календарём. inline: календарь раскрывается внутри формы,
 * а не всплывает (окно ⌥Space подстраивает высоту под содержимое и обрезало бы всплывающую панель)
 */
export function DateField(props: { value: string | null; onChange: (d: string | null) => void; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const t = today();
  const chips = [t, addDays(t, 1), nextMonday()].filter((d, i, a) => a.indexOf(d) === i);
  const other = !!props.value && !chips.includes(props.value);
  const pick = (d: string | null) => (setOpen(false), props.onChange(d));
  const cal = <Calendar value={props.value} onPick={pick} />;
  return (
    <>
      {chips.map((d) => (
        <Chip key={d} on={props.value === d} accent="stand" onClick={() => props.onChange(props.value === d ? null : d)}>{fmtDay(d)}</Chip>
      ))}
      <button type="button" ref={btn} className={`chip ${other ? "on" : ""}`} onClick={() => setOpen((o) => !o)}
        style={other ? { background: "var(--stand)" } : undefined}>
        <CalendarDays size={13} /> {other ? fmtDay(props.value!) : "Другая"}
      </button>
      {open && (props.inline ? <div className="inline-pop">{cal}</div> : (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={260}>{cal}</Popover>
      ))}
    </>
  );
}

// Время «от–до»

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const LAST = 23 * 60 + 59;

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return [h && `${h} ч`, m && `${m} мин`].filter(Boolean).join(" ") || "0 мин";
}

/** «10:00–11:30» для строки списка */
export function fmtRange(start: string | null, end: string | null): string {
  return start ? (end ? `${start}–${end}` : start) : "";
}

const DURATIONS = [15, 30, 60, 90, 120];

/**
 * Начало и конец в один день. Конец без начала не бывает, конец раньше начала не принимается.
 * Если сдвинуть начало, конец едет следом и длительность сохраняется, как в календаре.
 * Убрать время: стереть часы начала
 */
export function TimeRange(props: { start: string | null; end: string | null; disabled?: boolean; onChange: (start: string | null, end: string | null) => void }) {
  const { start, end } = props;
  const [bump, setBump] = useState(0); // пересоздать поле конца, если введённое значение отклонено
  const dur = start && end ? toMin(end) - toMin(start) : 0;
  const setStart = (v: string) => {
    if (!v) return props.onChange(null, null);
    props.onChange(v, end && start ? toHHMM(Math.min(LAST, toMin(v) + dur)) : null);
  };
  const setEnd = (v: string) => {
    if (!v) return props.onChange(start, null);
    if (!start || toMin(v) <= toMin(start)) return setBump((n) => n + 1);
    props.onChange(start, v);
  };
  return (
    <>
      <TimeInput value={start ?? ""} disabled={props.disabled} onCommit={setStart} />
      <span className="dash">–</span>
      <TimeInput key={bump} value={end ?? ""} disabled={props.disabled || !start} onCommit={setEnd} />
      {start && end && <span className="hint">{fmtDuration(dur)}</span>}
      {start && !props.disabled && (
        <div className="seg durations">
          {DURATIONS.map((d) => (
            <button type="button" key={d} className={`mini ${dur === d ? "on" : ""}`}
              onClick={() => props.onChange(start, toHHMM(Math.min(LAST, toMin(start) + d)))}>
              {d < 60 ? `${d}м` : `${d / 60}ч`.replace(".5", ",5")}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// Важность

/** Пять ступеней со значками, повторный клик снимает важность. Подпись справа: выбранная или та, что под курсором */
export function PriorityPicker(props: { value: number | null | undefined; onChange: (p: number | null) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? props.value ?? 0;
  return (
    <div className="prio-box">
      <div className="prio-pick" role="radiogroup" aria-label="Важность" onMouseLeave={() => setHover(null)}>
        {PRIORITY.map((p) => {
          const on = props.value === p.value;
          return (
            <button type="button" key={p.value} role="radio" aria-checked={on} aria-label={p.name} title={p.name}
              className={`prio-opt ${on ? "on" : ""}`} style={{ "--c": `var(--${p.accent})` } as React.CSSProperties}
              onMouseEnter={() => setHover(p.value)} onClick={() => props.onChange(on ? null : p.value)}>
              <PriorityIcon p={p.value} size={16} />
            </button>
          );
        })}
      </div>
      <span className={`prio-cap ${hover && hover !== props.value ? "preview" : ""}`}>{shown ? PRIORITY[shown - 1].name : "Не задана"}</span>
    </div>
  );
}

// Матрица Эйзенхауэра

export const QUADRANTS = [
  // Свои чистые цвета (task.css): красный, синий, оранжевый, фиолетовый, без серого
  { value: 1, name: "Срочно и важно", hint: "сделать сейчас", accent: "q1" },
  { value: 2, name: "Важно, не срочно", hint: "запланировать", accent: "q2" },
  { value: 3, name: "Срочно, не важно", hint: "делегировать", accent: "q3" },
  { value: 4, name: "Не срочно, не важно", hint: "отложить", accent: "q4" },
];

/** Необязательный квадрант: 2×2, повторный клик снимает выбор */
export function QuadrantPicker(props: { value: number | null; onChange: (q: number | null) => void }) {
  return (
    <div className="quad" role="radiogroup" aria-label="Матрица Эйзенхауэра">
      {QUADRANTS.map((q) => {
        const on = props.value === q.value;
        return (
          <button type="button" key={q.value} role="radio" aria-checked={on} className={`quad-cell ${on ? "on" : ""}`}
            style={on ? { background: `var(--${q.accent})` } : { borderColor: `color-mix(in srgb, var(--${q.accent}) 35%, var(--line))` }}
            onClick={() => props.onChange(on ? null : q.value)}>
            <b>{q.name}</b>
            <span>{q.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Значок квадранта в строке задачи: сетка 2×2 с закрашенной клеткой */
export function QuadrantGlyph({ q }: { q: number }) {
  const info = QUADRANTS[q - 1];
  if (!info) return null;
  const x = q === 1 || q === 3 ? 0 : 7, y = q <= 2 ? 0 : 7;
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" className="quad-glyph" aria-label={info.name}>
      <title>{info.name}</title>
      {[0, 7].flatMap((cx) => [0, 7].map((cy) => (
        <rect key={`${cx}${cy}`} x={cx} y={cy} width="6" height="6" rx="1.5"
          fill={cx === x && cy === y ? `var(--${info.accent})` : "var(--ring-track)"} />
      )))}
    </svg>
  );
}

// Повтор

/** Кнопка с текущим правилом и редактор правила. inline — для формы записи задачи */
export function RepeatField(props: { value: string | null; due: string | null; onChange: (json: string | null) => void; inline?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const rule = parseRule(props.value);
  const apply = (r: Rule | null) => {
    setOpen(false);
    props.onChange(r ? JSON.stringify(r) : null);
  };
  const editor = <RuleEditor rule={rule} due={props.due ?? today()} onApply={apply} />;
  return (
    <>
      <button type="button" ref={btn} className={`chip ${rule ? "on" : ""}`} disabled={props.disabled}
        style={rule ? { background: "var(--stand)" } : undefined} onClick={() => setOpen((o) => !o)}>
        <Repeat size={13} /> {rule ? describe(rule) : "Не повторять"}
      </button>
      {open && (props.inline ? <div className="inline-pop">{editor}</div> : (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={318}>{editor}</Popover>
      ))}
    </>
  );
}

const FREQS: { value: Freq; name: string }[] = [
  { value: "day", name: "дни" },
  { value: "week", name: "недели" },
  { value: "month", name: "месяцы" },
  { value: "year", name: "годы" },
];

function RuleEditor(props: { rule: Rule | null; due: string; onApply: (r: Rule | null) => void }) {
  const { due } = props;
  const [r, setR] = useState<Rule>(props.rule ?? anchorRule({ freq: "week", every: 1 }, due));
  const [untilOpen, setUntilOpen] = useState(false);
  const set = (patch: Partial<Rule>) => setR((cur) => ({ ...cur, ...patch }));
  const setFreq = (freq: Freq) =>
    setR((cur) => anchorRule({ freq, every: cur.every, fromDone: cur.fromDone, until: cur.until, count: cur.count, monthBy: freq === "month" ? "day" : undefined }, due));
  const d = parseDay(due);
  const nth = Math.min(Math.ceil(d.getDate() / 7), 4);
  const isLast = d.getDate() + 7 > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const ending = r.until ? "until" : r.count != null ? "count" : "never";
  const valid = r.freq !== "week" || !!r.days?.length;

  return (
    <div className="rule">
      <div className="seg">
        <Chip on={!props.rule} accent="muted" onClick={() => props.onApply(null)}>Не повторять</Chip>
        {PRESETS.map((p) => (
          <Chip key={p.name} on={!!props.rule && describe(props.rule) === describe(anchorRule(p.rule, due))} accent="stand"
            onClick={() => props.onApply(anchorRule(p.rule, due))}>{p.name}</Chip>
        ))}
      </div>

      <div className="lbl rule-sep">Своё правило</div>
      <Line label="Каждые">
        <input className="field num" type="number" min={1} max={365} value={r.every}
          onChange={(e) => set({ every: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} />
        {FREQS.map((f) => <Chip key={f.value} on={r.freq === f.value} accent="stand" onClick={() => setFreq(f.value)}>{f.name}</Chip>)}
      </Line>
      {r.freq === "week" && (
        <Line label="По">
          {WD_SHORT.map((w, i) => {
            const day = i + 1, on = !!r.days?.includes(day);
            return (
              <button type="button" key={w} className={`mini wd ${on ? "on" : ""}`}
                onClick={() => set({ days: on ? r.days!.filter((x) => x !== day) : [...(r.days ?? []), day].sort() })}>{w}</button>
            );
          })}
        </Line>
      )}
      {r.freq === "month" && (
        <Line label="Когда">
          <Chip on={r.monthBy !== "nth"} accent="stand" onClick={() => set({ monthBy: "day", day: d.getDate(), nth: undefined, weekday: undefined })}>
            {d.getDate()} числа
          </Chip>
          <Chip on={r.monthBy === "nth" && r.nth !== -1} accent="stand" onClick={() => set({ monthBy: "nth", nth, weekday: isoWeekday(d), day: undefined })}>
            {nthLabel(nth, isoWeekday(d))}
          </Chip>
          {isLast && (
            <Chip on={r.monthBy === "nth" && r.nth === -1} accent="stand" onClick={() => set({ monthBy: "nth", nth: -1, weekday: isoWeekday(d), day: undefined })}>
              {nthLabel(-1, isoWeekday(d))}
            </Chip>
          )}
        </Line>
      )}
      <Line label="Считать">
        <Chip on={!r.fromDone} accent="stand" onClick={() => set({ fromDone: false })} title="Следующий повтор по календарю, даже если эту сделал позже">По расписанию</Chip>
        <Chip on={!!r.fromDone} accent="stand" onClick={() => set({ fromDone: true })} title="Например, «полить цветы через 3 дня после того, как полил»">От выполнения</Chip>
      </Line>
      <Line label="Конец">
        <Chip on={ending === "never"} accent="stand" onClick={() => set({ until: null, count: null })}>Никогда</Chip>
        <Chip on={ending === "count"} accent="stand" onClick={() => set({ until: null, count: r.count ?? 10 })}>После</Chip>
        {ending === "count" && (
          <>
            <input className="field num" type="number" min={1} max={999} value={r.count ?? 1}
              onChange={(e) => set({ count: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} />
            <span className="hint">раз</span>
          </>
        )}
        <Chip on={ending === "until"} accent="stand" onClick={() => setUntilOpen((o) => !o)}>
          {r.until ? `До ${fmtDay(r.until).toLowerCase()}` : "Дата"}
        </Chip>
      </Line>
      {untilOpen && (
        <div className="inline-pop">
          <Calendar value={r.until ?? null} onPick={(day) => (setUntilOpen(false), set({ until: day, count: null }))} />
        </div>
      )}
      <div className="rule-foot">
        <span className="hint">{valid ? describe(r) : "Выбери хотя бы один день недели"}</span>
        <button type="button" className="cta stand narrow" disabled={!valid} onClick={() => props.onApply(r)}>Готово</button>
      </div>
    </div>
  );
}

// Чеклист

/** Подзадачи: отметка, правка на месте, перетаскивание за ручку слева */
export function Checklist(props: { task: Task; locked?: boolean; run: RunDb }) {
  const { task, run } = props;
  const subs = task.subtasks;
  const [order, setOrder] = useState<number[] | null>(null);
  const [draft, setDraft] = useState("");
  const newRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const subsKey = subs.map((s) => s.id).join(",");
  useEffect(() => setOrder(null), [subsKey]);
  const items = order ? order.map((id) => subs.find((s) => s.id === id)!).filter(Boolean) : subs;

  // Перетаскивание на указателе мыши: работает и в WebView macOS, где HTML5 drag-and-drop занят файлами
  const geo = useRef<{ tops: number[]; hs: number[]; startY: number }>({ tops: [], hs: [], startY: 0 });
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  const [settle, setSettle] = useState<{ id: number; offset: number } | null>(null);
  useLayoutEffect(() => {
    if (!settle) return;
    const f = requestAnimationFrame(() => requestAnimationFrame(() => setSettle(null)));
    return () => cancelAnimationFrame(f);
  }, [settle]);

  const startDrag = (e: React.PointerEvent, i: number) => {
    if (props.locked || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(".sub") ?? [])];
    geo.current = { tops: rows.map((r) => r.offsetTop), hs: rows.map((r) => r.offsetHeight), startY: e.clientY };
    setDrag({ from: i, to: i, dy: 0 });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const { tops, hs, startY } = geo.current;
    const dy = e.clientY - startY;
    const center = tops[drag.from] + hs[drag.from] / 2 + dy;
    const to = tops.filter((t, j) => j !== drag.from && t + hs[j] / 2 < center).length;
    setDrag({ ...drag, dy, to });
  };
  const endDrag = () => {
    if (!drag) return;
    const { from, to, dy } = drag;
    setDrag(null);
    if (from === to) return;
    const ids = items.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    const { tops } = geo.current;
    // Карточка плавно доезжает из точки, где её отпустили, на новое место
    setSettle({ id: moved, offset: tops[from] + dy - tops[to] });
    setOrder(ids);
    run(() => db.reorderSubtasks(ids));
  };

  const shiftFor = (i: number): React.CSSProperties => {
    if (settle) return items[i].id === settle.id ? { transform: `translateY(${settle.offset}px)`, transition: "none" } : { transition: "none" };
    if (!drag) return {};
    const { hs, tops } = geo.current;
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, transition: "none", zIndex: 2 };
    const gap = tops.length > 1 ? tops[1] - tops[0] - hs[0] : 0;
    const h = hs[drag.from] + gap;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return { transform: `translateY(${-h}px)` };
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return { transform: `translateY(${h}px)` };
    return {};
  };

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    run(() => db.addSubtask(task.id, t, (subs[subs.length - 1]?.position ?? 0) + 1));
  };

  return (
    <div className="checklist">
      <div ref={listRef} className={`subs ${drag ? "dragging" : ""}`}>
        {items.map((s, i) => (
          <div key={s.id} className={`sub ${s.done ? "done" : ""} ${drag?.from === i ? "lifted" : ""}`} style={shiftFor(i)}>
            {!props.locked && (
              <span className="grip" title="Перетащи, чтобы поменять порядок"
                onPointerDown={(e) => startDrag(e, i)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                <GripVertical size={13} />
              </span>
            )}
            <button type="button" className="chk small" disabled={props.locked} title={s.done ? "Не сделано" : "Сделано"}
              onClick={() => run(() => db.updateSubtask(s.id, { done: s.done ? 0 : 1 }))} />
            <SubTitle value={s.title} disabled={props.locked}
              onCommit={(v) => run(() => (v ? db.updateSubtask(s.id, { title: v }) : db.deleteSubtask(s.id)))}
              onEnter={() => newRef.current?.focus()} />
            {!props.locked && (
              <button type="button" className="x" title="Удалить пункт" onClick={() => run(() => db.deleteSubtask(s.id))}><X size={12} /></button>
            )}
          </div>
        ))}
      </div>
      {!props.locked && (
        <input ref={newRef} className="field sub-new" placeholder="+ Пункт чеклиста, Enter добавит" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.preventDefault(), e.stopPropagation(), add());
          }}
          onBlur={add} />
      )}
    </div>
  );
}

/** Текст пункта переносится по строкам, поле растёт по высоте. Enter не делает новую строку, а сохраняет */
function SubTitle(props: { value: string; disabled?: boolean; onCommit: (v: string) => void; onEnter: () => void }) {
  const [v, setV] = useState(props.value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, v, 2000);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => v.trim() !== props.value && props.onCommit(v.trim());
  return (
    <textarea ref={ref} rows={1} className="sub-t" value={v} disabled={props.disabled} onChange={(e) => setV(e.target.value.replace(/\n/g, " "))} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.preventDefault(), e.stopPropagation(), commit(), props.onEnter());
        if (e.key === "Escape") setV(props.value);
      }} />
  );
}

// Ссылки и файлы

/** Добавляет https://, если схемы нет. null — на ссылку не похоже */
export function normalizeUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol === "mailto:") return s;
    if (!/^https?:$/.test(u.protocol) || !(u.hostname.includes(".") || u.hostname === "localhost")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "mailto:") return u.pathname;
    return (u.hostname.replace(/^www\./, "") + u.pathname + u.search).replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function fmtSize(b: number): string {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} КБ`;
  return `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

/** Ссылки: адрес, потом необязательное название. С названием показываем гиперссылку, без него сам адрес */
export function Links(props: { task: Task; locked?: boolean; run: RunDb; onError: (e: string) => void }) {
  const { task, run } = props;
  const [url, setUrl] = useState("");
  const [bad, setBad] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // адрес принят, ждём название
  const [title, setTitle] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (pending) titleRef.current?.focus();
  }, [pending]);

  const takeUrl = () => {
    if (!url.trim()) return setBad(false);
    const u = normalizeUrl(url);
    if (!u) return setBad(true);
    setUrl("");
    setBad(false);
    setTitle("");
    setPending(u);
  };
  const save = (name: string) => {
    if (!pending) return;
    const u = pending;
    setPending(null);
    run(() => db.addLink(task.id, u, name.trim(), (task.links[task.links.length - 1]?.position ?? 0) + 1));
  };
  const copy = (id: number, u: string) => {
    navigator.clipboard.writeText(u).then(
      () => (setCopied(id), setTimeout(() => setCopied((c) => (c === id ? null : c)), 1400)),
      (e) => props.onError(String(e)),
    );
  };
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();

  return (
    <div className="attach">
      {task.links.map((l) => (
        <div key={l.id} className="att">
          <Link2 size={14} className="att-ic" />
          {renaming === l.id ? (
            <input autoFocus className="field att-ren" defaultValue={l.title} placeholder="Название, пусто — показывать адрес"
              onKeyDown={(e) => {
                stop(e);
                if (e.key === "Enter") (e.preventDefault(), (e.target as HTMLInputElement).blur());
                if (e.key === "Escape") setRenaming(null);
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                setRenaming(null);
                if (v !== l.title) run(() => db.renameLink(l.id, v));
              }} />
          ) : (
            <a href={l.url} className={`att-link ${l.title ? "" : "raw"}`} title={l.url}
              onClick={(e) => (e.preventDefault(), db.openUrl(l.url).catch((err) => props.onError(String(err))))}>
              {l.title || prettyUrl(l.url)}
            </a>
          )}
          <button type="button" className={`x show ${copied === l.id ? "ok" : ""}`} title={copied === l.id ? "Скопировано" : "Скопировать ссылку"}
            onClick={() => copy(l.id, l.url)}>{copied === l.id ? <Check size={12} /> : <Copy size={12} />}</button>
          {!props.locked && renaming !== l.id && (
            <button type="button" className="x" title="Переименовать" onClick={() => setRenaming(l.id)}><Pencil size={12} /></button>
          )}
          {!props.locked && <button type="button" className="x" title="Убрать ссылку" onClick={() => run(() => db.deleteLink(l.id))}><X size={12} /></button>}
        </div>
      ))}
      {!props.locked && (pending ? (
        <div className="link-new">
          <div className="link-new-head">
            <span className="url">{prettyUrl(pending)}</span>
            <button type="button" className="x show" title="Отмена" onClick={() => setPending(null)}><X size={12} /></button>
          </div>
          <input ref={titleRef} className="field" placeholder="Название, необязательно" value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              stop(e);
              if (e.key === "Enter") (e.preventDefault(), save(title));
              if (e.key === "Escape") (e.preventDefault(), save(""));
            }} />
          <div className="link-btns">
            <button type="button" className="btn small" onClick={() => save("")}>Без названия</button>
            <button type="button" className="btn small primary" onClick={() => save(title)}>Добавить ⏎</button>
          </div>
        </div>
      ) : (
        <>
          <input className={`field link-in ${bad ? "bad" : ""}`} placeholder="Вставь ссылку и нажми Enter" value={url}
            onChange={(e) => (setUrl(e.target.value), setBad(false))} onBlur={takeUrl}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.stopPropagation(), takeUrl())} />
          {bad && <div className="hint">Не похоже на ссылку</div>}
        </>
      ))}
    </div>
  );
}

/** Прикреплённые файлы: копии лежат в папке приложения */
export function Files(props: { task: Task; locked?: boolean; run: RunDb; onError: (e: string) => void }) {
  const { task, run } = props;
  const pickFiles = async () => {
    try {
      const paths = await openDialog({ multiple: true, directory: false, title: "Прикрепить к задаче" });
      if (paths?.length) run(() => db.attachFiles(task.id, paths));
    } catch (e) {
      props.onError(String(e));
    }
  };
  const safe = (p: Promise<unknown>) => p.catch((e) => props.onError(String(e)));
  return (
    <div className="attach">
      {task.files.map((f) => (
        <div key={f.id} className="att">
          <FileText size={14} className="att-ic" />
          <button type="button" className="att-name" title="Открыть" onClick={() => safe(db.openFile(f.path))}>{f.name}</button>
          <span className="meta">{fmtSize(f.size)}</span>
          <button type="button" className="x show" title="Показать в Finder" onClick={() => safe(db.revealFile(f.path))}><FolderSearch size={12} /></button>
          {!props.locked && <button type="button" className="x" title="Открепить файл" onClick={() => run(() => db.deleteAttachment(f))}><X size={12} /></button>}
        </div>
      ))}
      {!props.locked && (
        <div className="files-add">
          <button type="button" className="btn small" onClick={pickFiles} title="Выбрать файлы в Finder"><Paperclip size={13} /> Файл</button>
          <span className="hint">или перетащи из Finder на задачу</span>
        </div>
      )}
    </div>
  );
}
