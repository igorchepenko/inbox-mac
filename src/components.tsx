import { useEffect, useRef, useState } from "react";
import * as db from "./db";
import type { Draft, Project, Tag, Task } from "./db";
import { stampTime, today } from "./dates";
import { useAutosize } from "./widgets";
import { firstOccurrence, parseRule } from "./recurrence";
import { Paperclip } from "lucide-react";
import { Checklist, DateField, Files, Line, Links, PriorityPicker, QuadrantPicker, RepeatField, TimeRange, type RunDb } from "./extras";
import { quickKeyLabel } from "./prefs";
import { PersonInput, TagInput } from "./TagsUI";
import { fmtCreated, KindSwitch, RemindField } from "./TaskBits";
import { remindPatch, remindAtFor } from "./remind";
import { SpacePicker } from "./SpaceUI";
import { addTagName, canonicalPerson, parseQuick } from "./tags";

export { PRIORITY } from "./priority";

/** Карточка записи задачи. Используется и в отдельном окне ⌥Space, и внутри приложения по N.
 * Дата, время, проект и остальное по желанию: блок свёрнут, открывается кнопкой или ⌘E */
export function QuickForm(props: { projects: Project[]; tags: Tag[]; people: string[]; onSave: (title: string, note: string, draft: Draft) => void; onCancel: () => void; profile?: string; initial?: Draft; remindBefore: number; onCreateProject?: (name: string) => Promise<number> }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [more, setMore] = useState(false);
  const [d, setD] = useState<Draft>(props.initial ?? {});
  const titleRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useAutosize(noteRef, note, 260);
  useEffect(() => titleRef.current?.focus(), []);
  const set = (patch: Partial<typeof d>) => setD((cur) => ({ ...cur, ...patch }));
  const filled = [d.due_date, d.start_time, d.remind_at, d.recurrence, d.project_id, d.priority, d.quadrant, d.assigned_by].filter((v) => v != null && v !== "").length
    + (d.tags?.length ? 1 : 0) + (d.kind === "meeting" ? 1 : 0);

  const submit = () => {
    // #тег и @Имя прямо в названии: убираем из текста, добавляем к выбранному в параметрах
    const q = parseQuick(title);
    const t = q.title || title.trim();
    if (!t) return titleRef.current?.focus();
    const draft = { ...d };
    if (q.title) {
      draft.tags = q.tags.reduce(addTagName, draft.tags ?? []);
      if (q.person && !draft.assigned_by) draft.assigned_by = canonicalPerson(q.person, props.people);
    }
    const rule = parseRule(draft.recurrence);
    if (!draft.due_date && (draft.start_time || draft.remind_at || rule)) draft.due_date = rule ? firstOccurrence(rule, today()) : today();
    // Напоминание считаем от окончательных даты и времени: их могли поменять после того, как включили напоминание
    if (draft.remind_at && draft.due_date) {
      draft.remind_at = draft.remind_before != null
        ? remindAtFor(draft.due_date, draft.start_time ?? null, draft.remind_before)
        : `${draft.due_date}T${stampTime(draft.remind_at)}`;
    }
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
          <Line label="Напомнить">
            <RemindField defaultBefore={props.remindBefore}
              value={{ due_date: d.due_date ?? null, start_time: d.start_time ?? null, remind_at: d.remind_at ?? null, remind_before: d.remind_before ?? null }}
              onChange={(p) => set({ ...("due_date" in p ? { due_date: p.due_date } : {}), remind_at: p.remind_at, remind_before: p.remind_before })} />
          </Line>
          <Line label="Повтор"><RepeatField inline value={d.recurrence ?? null} due={d.due_date ?? null} onChange={(v) => set({ recurrence: v })} /></Line>
          {(props.projects.length > 0 || props.onCreateProject) && (
            <Line label="Пространство">
              <SpacePicker projects={props.projects} value={d.project_id ?? null} onChange={(id) => set({ project_id: id })} onCreate={props.onCreateProject} />
            </Line>
          )}
          <Line label="Тип"><KindSwitch value={d.kind ?? "task"} onChange={(kind) => set({ kind })} /></Line>
          <Line label="Важность"><PriorityPicker value={d.priority} onChange={(p) => set({ priority: p ?? undefined })} /></Line>
          <Line label="Матрица"><QuadrantPicker value={d.quadrant ?? null} onChange={(q) => set({ quadrant: q })} /></Line>
          <Line label="Теги"><TagInput value={d.tags ?? []} tags={props.tags} onChange={(tags) => set({ tags })} /></Line>
          <Line label="От кого"><PersonInput value={d.assigned_by ?? null} people={props.people} onChange={(v) => set({ assigned_by: v })} /></Line>
        </div>
      )}
      <div className="qi-foot">
        <button type="button" className={`more-btn ${more ? "on" : ""}`} onClick={() => setMore((m) => !m)} data-tip="Дата, напоминание, пространство, теги" data-key="⌘E">
          {more ? "Скрыть параметры" : filled ? `Параметры · ${filled}` : "+ Дата, напоминание, теги…"}
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

export type TaskPatch = Partial<Pick<Task, "title" | "note" | "priority" | "project_id" | "due_date" | "remind_at" | "reminded" | "start_time" | "end_time" | "quadrant" | "recurrence" | "assigned_by" | "remind_before" | "kind">>;

export function Details(props: {
  task: Task;
  projects: Project[];
  tags: Tag[];
  people: string[];
  remindBefore: number;
  onPatch: (patch: TaskPatch) => void;
  onCreateProject?: (name: string) => Promise<number>;
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
  const subsDone = x.subtasks.filter((s) => s.done).length;

  const saveTitle = () => {
    const v = title.trim();
    if (v && v !== x.title) onPatch({ title: v });
    else setTitle(x.title);
  };
  // Напоминание едет вместе с датой и временем: «за 15 минут» пересчитывается, своё время сдвигается на те же дни
  const setDate = (d: string | null) => onPatch({ due_date: d, ...remindPatch(x, { due_date: d }) });
  // Время и повтор без даты не имеют смысла: дату ставим сами, если её нет
  const setTimes = (start: string | null, end: string | null) => {
    const p: TaskPatch = start && !x.due_date ? { start_time: start, end_time: end, due_date: t } : { start_time: start, end_time: end };
    onPatch({ ...p, ...(start !== x.start_time ? remindPatch(x, p) : {}) });
  };
  const setRepeat = (json: string | null) => {
    const rule = parseRule(json);
    onPatch(rule && !x.due_date ? { recurrence: json, due_date: firstOccurrence(rule, t) } : { recurrence: json });
  };

  const asideRef = useRef<HTMLElement>(null);
  return (
    <aside ref={asideRef} className={`det ${props.dropping ? "dropping" : ""}`}>
      <div>
        <div className="lbl">{isInbox ? "Разбор" : locked ? "В архиве" : x.kind === "meeting" ? "Встреча" : "Задача"}</div>
        <textarea className="det-title" rows={1} value={title} disabled={locked}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
          onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }} />
      </div>

      <div className="det-created hint" title={x.created_at}>Создана {fmtCreated(x.created_at).toLowerCase()}</div>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Тип</div>
        <div className="seg"><KindSwitch value={x.kind} onChange={(kind) => onPatch({ kind })} /></div>
      </fieldset>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Важность</div>
        <PriorityPicker value={x.priority} onChange={(p) => onPatch({ priority: p ?? 0 })} />
        <div className="lbl sub-lbl">Матрица Эйзенхауэра <span className="opt">необязательно</span></div>
        <QuadrantPicker value={x.quadrant} onChange={(q) => onPatch({ quadrant: q })} />
      </fieldset>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Пространство</div>
        <div className="seg">
          <SpacePicker projects={projects} value={x.project_id} onChange={(id) => onPatch({ project_id: id })} onCreate={props.onCreateProject} />
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
          <RemindField value={x} reminded={!!x.reminded} defaultBefore={props.remindBefore} disabled={locked} onChange={onPatch} />
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
  ["⌘E", "Дата, напоминание, пространство, теги при записи"],
  ["#тег @Имя", "В названии: тег и кто назначил"],
  ["↑ ↓", "Выбрать задачу"],
  ["Enter", "Разобрать (в «Новые»)"],
  ["Space", "Сделано / вернуть"],
  ["1 … 5", "Важность: от минимальной до максимальной"],
  ["T", "Дата: сегодня"],
  ["⌘0", "Главная"],
  ["⌘1 … ⌘5", "Новые, Сегодня, Скоро, Архив, Календарь"],
  ["⌘6", "Все пространства карточками"],
  ["⌘F", "Поиск по всем задачам, Enter открывает найденную в её списке"],
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
