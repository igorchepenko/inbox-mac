import { useEffect, useRef, useState } from "react";
import type { Project, Task } from "./db";
import { addDays, fmtDay, nextMonday, today } from "./dates";
import { CalendarDays } from "lucide-react";
import { Icon } from "./icons";
import { Calendar, Popover, TimeInput, useAutosize } from "./widgets";

export const PRIORITY = [
  // Зелёный и бирюзовый заняты под «сделано» и время, поэтому важность берёт нейтральный и янтарный
  { value: 1, name: "Низкая", accent: "muted" },
  { value: 2, name: "Средняя", accent: "amber" },
  { value: 3, name: "Высокая", accent: "move" },
];

/** Карточка быстрого ввода: название и заметка. Используется и в отдельном окне ⌥Space, и внутри приложения по N */
export function QuickForm(props: { onSave: (title: string, note: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useAutosize(noteRef, note, 260);
  useEffect(() => titleRef.current?.focus(), []);

  const submit = () => {
    const t = title.trim();
    if (t) props.onSave(t, note.trim());
    else titleRef.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel();
    }
    // Enter в названии сохраняет, в заметке нужен ⌘Enter, обычный Enter переносит строку
    if (e.key === "Enter" && (e.target === titleRef.current || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form className="qi" onSubmit={(e) => (e.preventDefault(), submit())} onKeyDown={onKey}>
      <input ref={titleRef} className="field qi-title" placeholder="Что нужно сделать?" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" spellCheck={false} />
      <textarea ref={noteRef} rows={2} className="field qi-note" placeholder="Заметка, если нужна" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="qi-foot">
        <span>Попадёт в «На разбор»</span>
        <kbd>Esc</kbd>
        <span>закрыть</span>
        <button className="cta" type="submit">Сохранить ⏎</button>
      </div>
    </form>
  );
}

/** Кольцо прогресса в логике Apple Fitness, внутри число оставшихся задач */
export function Ring({ fraction, accent, count }: { fraction: number; accent: string; count: number }) {
  const r = 22, c = 2 * Math.PI * r;
  const label = count > 99 ? "99+" : count > 0 ? String(count) : fraction > 0 ? "✓" : "";
  return (
    <svg className="ring" width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
      <circle cx="27" cy="27" r={r} fill="none" stroke="var(--ring-track)" strokeWidth="8" />
      {fraction > 0 && (
        <circle cx="27" cy="27" r={r} fill="none" stroke={`var(--${accent})`} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${c * fraction} ${c}`} transform="rotate(-90 27 27)" />
      )}
      <text x="27" y="27" textAnchor="middle" dominantBaseline="central" className={`ring-n ${label.length > 2 ? "small" : ""}`}
        fill={label === "✓" ? `var(--${accent})` : "var(--fg)"}>{label}</text>
    </svg>
  );
}

export type TaskPatch = Partial<Pick<Task, "title" | "note" | "priority" | "project_id" | "due_date" | "remind_at" | "reminded">>;

export function Details(props: {
  task: Task;
  projects: Project[];
  onPatch: (patch: TaskPatch) => void;
  onTriage: () => void;
  onToggleDone: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { task: x, projects, onPatch } = props;
  const [title, setTitle] = useState(x.title);
  const [note, setNote] = useState(x.note);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const calBtn = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useAutosize(noteRef, note);
  const isInbox = x.status === "inbox";
  const locked = x.status === "archived";
  const t = today();
  const remindTime = x.remind_at?.slice(11, 16) ?? "";

  const saveTitle = () => {
    const v = title.trim();
    if (v && v !== x.title) onPatch({ title: v });
    else setTitle(x.title);
  };
  const setDate = (d: string | null) => {
    // Напоминание едет вместе с датой, время сохраняется
    const patch: TaskPatch = { due_date: d };
    if (remindTime) {
      patch.remind_at = `${d ?? t}T${remindTime}`;
      patch.reminded = 0;
    }
    onPatch(patch);
  };
  const pickDate = (d: string | null) => {
    setCalOpen(false);
    setDate(d);
  };
  const setRemind = (time: string) =>
    onPatch(time ? { remind_at: `${x.due_date ?? t}T${time}`, reminded: 0 } : { remind_at: null, reminded: 0 });

  const dateChips = [t, addDays(t, 1), nextMonday()].filter((d, i, a) => a.indexOf(d) === i);

  return (
    <aside className="det">
      <div>
        <div className="lbl">{isInbox ? "Разбор" : locked ? "В архиве" : "Задача"}</div>
        <textarea className="det-title" rows={1} value={title} disabled={locked}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
          onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }} />
      </div>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Важность</div>
        <div className="seg">
          {PRIORITY.map((p) => (
            <Chip key={p.value} on={x.priority === p.value} accent={p.accent}
              onClick={() => onPatch({ priority: x.priority === p.value ? 0 : p.value })}>{p.name}</Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Проект</div>
        <div className="seg">
          {projects.map((p) => (
            <Chip key={p.id} on={x.project_id === p.id} accent={p.color}
              onClick={() => onPatch({ project_id: x.project_id === p.id ? null : p.id })}>
              <Icon name={p.icon} size={12} /> {p.name}
            </Chip>
          ))}
          {!projects.length && <span className="hint">Создай проект в боковой панели</span>}
        </div>
      </fieldset>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Дата</div>
        <div className="seg">
          {dateChips.map((d) => (
            <Chip key={d} on={x.due_date === d} accent="stand" onClick={() => setDate(x.due_date === d ? null : d)}>{fmtDay(d)}</Chip>
          ))}
          {(() => {
            const other = !!x.due_date && !dateChips.includes(x.due_date);
            return (
              <button type="button" ref={calBtn} className={`chip ${other ? "on" : ""}`} onClick={() => setCalOpen((o) => !o)}
                style={other ? { background: "var(--stand)" } : undefined}>
                <CalendarDays size={13} /> {other ? fmtDay(x.due_date!) : "Другая"}
              </button>
            );
          })()}
          {calOpen && (
            <Popover anchor={calBtn.current} onClose={() => setCalOpen(false)} width={260}>
              <Calendar value={x.due_date} onPick={pickDate} />
            </Popover>
          )}
        </div>
      </fieldset>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Напоминание</div>
        <div className="seg">
          <TimeInput value={remindTime} disabled={locked} onCommit={setRemind} />
          {remindTime && (
            <>
              <span className="hint">{fmtDay(x.remind_at!.slice(0, 10))}{x.reminded ? ", уже пришло" : ""}</span>
              <button className="link" onClick={() => setRemind("")}>убрать</button>
            </>
          )}
        </div>
      </fieldset>

      <div className="det-sec">
        <div className="lbl">Заметка</div>
        <textarea ref={noteRef} rows={3} className="field note" value={note} placeholder="Пусто" disabled={locked}
          onChange={(e) => setNote(e.target.value)} onBlur={() => note !== x.note && onPatch({ note })} />
      </div>

      <div className="det-actions">
        {isInbox && <button className="cta" onClick={props.onTriage}>Разобрано ⏎</button>}
        {x.status === "active" && <button className="cta go" onClick={props.onToggleDone}>Сделано</button>}
        {x.status === "done" && (
          <div className="row-btns">
            <button className="btn" onClick={props.onToggleDone}>Вернуть</button>
            <button className="cta go" onClick={props.onArchive}>В архив</button>
          </div>
        )}
        {locked && <button className="cta stand" onClick={props.onRestore}>Вернуть в работу</button>}
        <div className="hint">
          {isInbox
            ? x.project_id || x.due_date
              ? "После разбора задача уйдёт в нужные списки."
              : "Без проекта и даты задача после разбора окажется в «Скоро», в группе «Без даты»."
            : x.status === "done"
              ? "Сделанные сами уйдут в архив завтра."
              : null}
        </div>
        <button className={`link danger ${confirmDelete ? "armed" : ""}`}
          onClick={() => (confirmDelete ? props.onDelete() : setConfirmDelete(true))}
          onBlur={() => setConfirmDelete(false)}>
          {confirmDelete ? "Точно удалить? Нажми ещё раз" : "Удалить задачу"}
        </button>
      </div>
    </aside>
  );
}

function Chip(props: { on: boolean; accent: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`chip ${props.on ? "on" : ""}`} style={props.on ? { background: `var(--${props.accent})` } : undefined}
      onClick={props.onClick}>{props.children}</button>
  );
}

export const SHORTCUTS: [string, string][] = [
  ["⌥ Space", "Быстрый ввод из любого приложения"],
  ["N", "Записать задачу"],
  ["↑ ↓", "Выбрать задачу"],
  ["Enter", "Разобрано (в «На разбор»)"],
  ["Space", "Сделано / вернуть"],
  ["1 2 3", "Важность: низкая, средняя, высокая"],
  ["T", "Дата: сегодня"],
  ["⌘1 … ⌘4", "На разбор, Сегодня, Скоро, Архив"],
  ["⌘-клик", "Выбрать несколько, ⇧-клик выделяет подряд"],
  ["⌘A", "Выбрать все в списке"],
  ["⌘/", "Эта шпаргалка"],
  ["Esc", "Закрыть"],
];

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="help">
        <h3>Клавиши</h3>
        {SHORTCUTS.map(([k, v]) => (
          <div className="help-row" key={k}><kbd>{k}</kbd><span>{v}</span></div>
        ))}
      </div>
    </div>
  );
}
