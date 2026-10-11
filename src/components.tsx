import { useEffect, useRef, useState } from "react";
import * as db from "./db";
import type { Draft, Project, Tag, Task } from "./db";
import { fmtDay, stampDay, stampTime, today } from "./dates";
import { Icon } from "./icons";
import { TimeInput, useAutosize } from "./widgets";
import { firstOccurrence, parseRule } from "./recurrence";
import { Paperclip } from "lucide-react";
import { Checklist, Chip, DateField, Files, Line, Links, PriorityPicker, QuadrantPicker, RepeatField, TimeRange, type RunDb } from "./extras";
import { quickKeyLabel } from "./prefs";
import { PersonInput, TagInput } from "./TagsUI";
import { DeadlineField } from "./DeadlineUI";
import { addTagName, canonicalPerson, parseQuick } from "./tags";

export { PRIORITY } from "./priority";

/** Карточка записи задачи. Используется и в отдельном окне ⌥Space, и внутри приложения по N.
 * Дата, время, проект и остальное по желанию: блок свёрнут, открывается кнопкой или ⌘E */
export function QuickForm(props: { projects: Project[]; tags: Tag[]; people: string[]; onSave: (title: string, note: string, draft: Draft) => void; onCancel: () => void; profile?: string; initial?: Draft }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [more, setMore] = useState(false);
  const [d, setD] = useState<Draft & { remind?: string }>(props.initial ?? {});
  const titleRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useAutosize(noteRef, note, 260);
  useEffect(() => titleRef.current?.focus(), []);
  const set = (patch: Partial<typeof d>) => setD((cur) => ({ ...cur, ...patch }));
  const filled = [d.due_date, d.deadline, d.start_time, d.remind, d.recurrence, d.project_id, d.priority, d.quadrant, d.assigned_by].filter((v) => v != null && v !== "").length
    + (d.tags?.length ? 1 : 0);

  const submit = () => {
    // #тег и @Имя прямо в названии: убираем из текста, добавляем к выбранному в параметрах
    const q = parseQuick(title);
    const t = q.title || title.trim();
    if (!t) return titleRef.current?.focus();
    const { remind, ...draft } = d;
    if (q.title) {
      draft.tags = q.tags.reduce(addTagName, draft.tags ?? []);
      if (q.person && !draft.assigned_by) draft.assigned_by = canonicalPerson(q.person, props.people);
    }
    const rule = parseRule(draft.recurrence);
    if (!draft.due_date && (draft.start_time || remind || rule)) draft.due_date = rule ? firstOccurrence(rule, today()) : today();
    if (remind) draft.remind_at = `${draft.due_date}T${remind}`;
    props.onSave(t, note.trim(), draft);
  };
  const onKey = (e: React.KeyboardEvent) => {
    // Клавиши формы не должны доходить до списка: иначе тот же Enter сразу «разберёт» выбранную задачу
    if (e.key === "Escape" || e.key === "Enter") e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel();
    }
    if (e.metaKey && e.code === "KeyE") {
      e.preventDefault();
      setMore((m) => !m);
    }
    // Enter в названии сохраняет, в заметке нужен ⌘Enter, обычный Enter переносит строку.
    // В остальных полях (время, число) Enter только подтверждает поле, а не отправляет форму
    if (e.key === "Enter") {
      if (e.target === titleRef.current || e.metaKey) {
        e.preventDefault();
        submit();
      } else if ((e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
    }
  };

  return (
    <form className="qi" onSubmit={(e) => (e.preventDefault(), submit())} onKeyDown={onKey}>
      <input ref={titleRef} className="field qi-title" placeholder="Что нужно сделать? #тег @кто назначил" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" spellCheck={false} />
      <textarea ref={noteRef} rows={2} className="field qi-note" placeholder="Заметка, если нужна" value={note} onChange={(e) => setNote(e.target.value)} />
      {more && (
        <div className="qi-more lines">
          <Line label="Дата"><DateField inline value={d.due_date ?? null} onChange={(v) => set({ due_date: v })} /></Line>
          <Line label="Время">
            <TimeRange start={d.start_time ?? null} end={d.end_time ?? null} onChange={(a, b) => set({ start_time: a, end_time: b })} />
          </Line>
          <Line label="Дедлайн"><DeadlineField inline value={d.deadline ?? null} onChange={(v) => set({ deadline: v })} /></Line>
          <Line label="Напомнить"><TimeInput value={d.remind ?? ""} onCommit={(v) => set({ remind: v || undefined })} /></Line>
          <Line label="Повтор"><RepeatField inline value={d.recurrence ?? null} due={d.due_date ?? null} onChange={(v) => set({ recurrence: v })} /></Line>
          {props.projects.length > 0 && (
            <Line label="Пространство">
              {props.projects.map((p) => (
                <Chip key={p.id} on={d.project_id === p.id} accent={p.color} onClick={() => set({ project_id: d.project_id === p.id ? null : p.id })}>
                  <Icon name={p.icon} size={12} /> {p.name}
                </Chip>
              ))}
            </Line>
          )}
          <Line label="Важность"><PriorityPicker value={d.priority} onChange={(p) => set({ priority: p ?? undefined })} /></Line>
          <Line label="Матрица"><QuadrantPicker value={d.quadrant ?? null} onChange={(q) => set({ quadrant: q })} /></Line>
          <Line label="Теги"><TagInput value={d.tags ?? []} tags={props.tags} onChange={(tags) => set({ tags })} /></Line>
          <Line label="От кого"><PersonInput value={d.assigned_by ?? null} people={props.people} onChange={(v) => set({ assigned_by: v })} /></Line>
        </div>
      )}
      <div className="qi-foot">
        <button type="button" className={`more-btn ${more ? "on" : ""}`} onClick={() => setMore((m) => !m)} data-tip="Дата, дедлайн, пространство, теги" data-key="⌘E">
          {more ? "Скрыть параметры" : filled ? `Параметры · ${filled}` : "+ Дата, дедлайн, теги…"}
        </button>
        <span className="grow" />
        <span>Попадёт в «Новые»{props.profile && <> профиля <b className="qi-profile">{props.profile}</b></>}</span>
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

export type TaskPatch = Partial<Pick<Task, "title" | "note" | "priority" | "project_id" | "due_date" | "remind_at" | "reminded" | "start_time" | "end_time" | "quadrant" | "recurrence" | "assigned_by" | "deadline" | "deadline_notified">>;

export function Details(props: {
  task: Task;
  projects: Project[];
  tags: Tag[];
  people: string[];
  onPatch: (patch: TaskPatch) => void;
  run: RunDb;
  onError: (e: string) => void;
  dropping?: boolean;
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
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useAutosize(noteRef, note);
  const isInbox = x.status === "inbox";
  const locked = x.status === "archived";
  const t = today();
  const remindTime = (x.remind_at ? stampTime(x.remind_at) : "");
  const subsDone = x.subtasks.filter((s) => s.done).length;

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
  const setRemind = (time: string) =>
    onPatch(time ? { remind_at: `${x.due_date ?? t}T${time}`, reminded: 0 } : { remind_at: null, reminded: 0 });
  // Время и повтор без даты не имеют смысла: дату ставим сами, если её нет
  const setTimes = (start: string | null, end: string | null) =>
    onPatch(start && !x.due_date ? { start_time: start, end_time: end, due_date: t } : { start_time: start, end_time: end });
  const setRepeat = (json: string | null) => {
    const rule = parseRule(json);
    onPatch(rule && !x.due_date ? { recurrence: json, due_date: firstOccurrence(rule, t) } : { recurrence: json });
  };

  const asideRef = useRef<HTMLElement>(null);
  return (
    <aside ref={asideRef} className={`det ${props.dropping ? "dropping" : ""}`}>
      <div>
        <div className="lbl">{isInbox ? "Разбор" : locked ? "В архиве" : "Задача"}</div>
        <textarea className="det-title" rows={1} value={title} disabled={locked}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
          onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }} />
      </div>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Важность</div>
        <PriorityPicker value={x.priority} onChange={(p) => onPatch({ priority: p ?? 0 })} />
        <div className="lbl sub-lbl">Матрица Эйзенхауэра <span className="opt">необязательно</span></div>
        <QuadrantPicker value={x.quadrant} onChange={(q) => onPatch({ quadrant: q })} />
      </fieldset>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Пространство</div>
        <div className="seg">
          {projects.map((p) => (
            <Chip key={p.id} on={x.project_id === p.id} accent={p.color}
              onClick={() => onPatch({ project_id: x.project_id === p.id ? null : p.id })}>
              <Icon name={p.icon} size={12} /> {p.name}
            </Chip>
          ))}
          {!projects.length && <span className="hint">Создай пространство в боковой панели</span>}
        </div>
      </fieldset>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Теги{x.tags.length ? <span className="opt"> {x.tags.length} из 6</span> : null}</div>
        <TagInput value={x.tags.map((g) => g.name)} tags={props.tags} disabled={locked}
          onChange={(names) => props.run(() => db.setTaskTags(x.id, names))} />
        <div className="lbl sub-lbl">Кто назначил <span className="opt">необязательно</span></div>
        <PersonInput value={x.assigned_by} people={props.people} disabled={locked} onChange={(v) => onPatch({ assigned_by: v })} />
      </fieldset>

      <fieldset className="det-sec lines" disabled={locked}>
        <div className="lbl">Когда</div>
        <div className="seg"><DateField value={x.due_date} onChange={setDate} /></div>
        <Line label="Время">
          <TimeRange start={x.start_time} end={x.end_time} disabled={locked} onChange={setTimes} />
        </Line>
        <Line label="Напомнить">
          <TimeInput value={remindTime} disabled={locked} onCommit={setRemind} />
          {remindTime && (
            <>
              <span className="hint">{fmtDay(stampDay(x.remind_at!))}{x.reminded ? ", уже пришло" : ""}</span>
              <button type="button" className="link" onClick={() => setRemind("")}>убрать</button>
            </>
          )}
        </Line>
        <Line label="Дедлайн">
          <DeadlineField value={x.deadline} disabled={locked} onChange={(v) => onPatch({ deadline: v, deadline_notified: 0 })} />
        </Line>
        <Line label="Повтор">
          <RepeatField value={x.recurrence} due={x.due_date} onChange={setRepeat} disabled={locked} />
        </Line>
      </fieldset>

      <div className="det-sec">
        <div className="lbl">Чеклист{x.subtasks.length ? <span className="opt"> {subsDone} из {x.subtasks.length}</span> : null}</div>
        <Checklist task={x} locked={locked} run={props.run} />
      </div>

      <div className="det-sec">
        <div className="lbl">Заметка</div>
        <textarea ref={noteRef} rows={3} className="field note" value={note} placeholder="Пусто" disabled={locked}
          onChange={(e) => setNote(e.target.value)} onBlur={() => note !== x.note && onPatch({ note })} />
      </div>

      <div className="det-sec">
        <div className="lbl">Ссылки{x.links.length ? <span className="opt"> {x.links.length}</span> : null}</div>
        <Links task={x} locked={locked} run={props.run} onError={props.onError} />
      </div>

      <div className="det-sec">
        <div className="lbl">Файлы{x.files.length ? <span className="opt"> {x.files.length}</span> : null}</div>
        <Files task={x} locked={locked} run={props.run} onError={props.onError} />
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
              : "Без пространства и даты задача после разбора окажется в «Скоро», в группе «Без даты»."
            : x.status === "done"
              ? x.recurrence && x.next_id ? "Следующий повтор уже в списке. Сделанные сами уйдут в архив завтра." : "Сделанные сами уйдут в архив завтра."
              : x.recurrence ? "Когда отметишь сделанной, появится следующий повтор." : null}
        </div>
        <button className={`link danger ${confirmDelete ? "armed" : ""}`}
          onClick={() => (confirmDelete ? props.onDelete() : setConfirmDelete(true))}
          onBlur={() => setConfirmDelete(false)}>
          {confirmDelete ? "Точно удалить? Нажми ещё раз" : "Удалить задачу"}
        </button>
      </div>
      {props.dropping && <DropZone over={asideRef.current} title={x.title} />}
    </aside>
  );
}

/** Зона «отпусти здесь» поверх панели задачи, пока над ней держат файлы из Finder.
 * Фиксированная по видимой области панели: рамка целиком на экране, даже если панель прокручена */
function DropZone({ over, title }: { over: HTMLElement | null; title: string }) {
  const r = over?.getBoundingClientRect();
  if (!r) return null;
  const pad = 8;
  return (
    <div className="drop-zone" style={{ top: r.top + pad, left: r.left + pad, width: r.width - pad * 2, height: r.height - pad * 2 }}>
      <div>
        <Paperclip size={26} />
        <b>Отпусти, чтобы прикрепить</b>
        <span>к задаче «{title}»</span>
      </div>
    </div>
  );
}

export const SHORTCUTS: [string, string][] = [
  ["⌥ Space", "Быстрый ввод из любого приложения"],
  ["N", "Записать задачу"],
  ["⌘E", "Дата, дедлайн, пространство, теги при записи"],
  ["#тег @Имя", "В названии: тег и кто назначил"],
  ["↑ ↓", "Выбрать задачу"],
  ["Enter", "Разобрать (в «Новые»)"],
  ["Space", "Сделано / вернуть"],
  ["1 … 5", "Важность: от минимальной до максимальной"],
  ["T", "Дата: сегодня"],
  ["⌘0", "Главная"],
  ["⌘1 … ⌘5", "Новые, Сегодня, Скоро, Архив, Календарь"],
  ["⌘6", "Все пространства карточками"],
  ["⌘P", "Найти пространство и перейти"],
  ["D W M  ← →", "Календарь: день, неделя, месяц, листать"],
  ["Клик в календаре", "Новая задача на это время, 30 минут"],
  ["⌘-клик", "Выбрать несколько, ⇧-клик выделяет подряд"],
  ["⌘A", "Выбрать все в списке"],
  ["⌃⌘S", "Скрыть или показать левое меню"],
  ["⌥⌘I", "Скрыть или показать панель задачи"],
  ["⌘/", "Эта шпаргалка"],
  ["⌘,", "Настройки"],
  ["Esc", "Закрыть"],
];

/** Все сочетания клавиш: открывается кнопкой с клавиатурой внизу меню или по ⌘/ */
export function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="help" role="dialog" aria-label="Сочетания клавиш">
        <div className="help-head">
          <h3>Сочетания клавиш</h3>
          <button className="help-x" aria-label="Закрыть" data-tip="Закрыть" data-key="Esc" onClick={onClose}>×</button>
        </div>
        <div className="help-grid">
          {SHORTCUTS.map(([k, v]) => (
            <div className="help-row" key={k}><kbd>{k === "⌥ Space" ? quickKeyLabel() : k}</kbd><span>{v}</span></div>
          ))}
        </div>
        <p className="hint help-foot">Подсказка с сочетанием появляется и при наведении на кнопку.</p>
      </div>
    </div>
  );
}
