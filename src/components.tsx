import { useEffect, useRef, useState } from "react";
import * as db from "./db";
import { isCancelled, isClosed, type Draft, type Project, type Tag, type Task } from "./db";
import { fmtStamp, today } from "./dates";
import { CloseX, useAutosize } from "./widgets";
import { firstOccurrence, parseRule } from "./recurrence";
import { Paperclip, Link2, FileText, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Checklist, DateField, Files, Line, Links, normalizeUrl, prettyUrl, PriorityPicker, QuadrantPicker, RepeatField, TimeRange, type RunDb } from "./extras";
import { quickKeyLabel } from "./prefs";
import { PeopleInput, PersonInput, TagInput } from "./TagsUI";
import { fmtCreated, KindSwitch, RelationsField, RemindField, WaitingField } from "./TaskBits";
import { anchorOf, remindPatch, remindAtFor, type When } from "./remind";
import { SpacePicker } from "./SpaceUI";
import { addTagName, canonicalPerson, parseQuick } from "./tags";
import { canMove, STAGES, stageOf, type Stage } from "./boardOps";
import { Icon } from "./icons";

export { PRIORITY } from "./priority";

/** Карточка записи задачи. Используется и в отдельном окне ⌥Space, и внутри приложения по N.
 * Дата, время, проект и остальное по желанию: блок свёрнут, открывается кнопкой или ⌘E */
export function QuickForm(props: { projects: Project[]; tags: Tag[]; people: string[]; onSave: (title: string, note: string, draft: Draft) => void; onCancel: () => void; closable?: boolean; profile?: string; initial?: Draft; remindBefore: number; onCreateProject?: (name: string) => Promise<number> }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [more, setMore] = useState(false);
  const [d, setD] = useState<Draft>(props.initial ?? {});
  const [badLink, setBadLink] = useState(false);
  const [newLink, setNewLink] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  useAutosize(noteRef, note, 260);
  useEffect(() => titleRef.current?.focus(), []);
  const set = (patch: Partial<typeof d>) => setD((cur) => ({ ...cur, ...patch }));
  const meeting = d.kind === "meeting";
  const filled = [d.stage, d.due_date, d.start_time ?? d.end_time, d.remind_at, d.recurrence, d.project_id, d.priority, d.quadrant, d.assigned_by].filter((v) => v != null && v !== "").length
    + (d.tags?.length ? 1 : 0) + (meeting ? 1 : 0) + (d.participants?.length ? 1 : 0) + (d.links?.length || newLink.trim() ? 1 : 0) + (d.files?.length ? 1 : 0);
  const when: When = { due_date: d.due_date ?? null, start_time: d.start_time ?? null, end_time: d.end_time ?? null, remind_at: d.remind_at ?? null, remind_before: d.remind_before ?? null };
  // Напоминание едет вместе с датой и временем, как в панели задачи
  const moveRemind = (next: Parameters<typeof remindPatch>[1]) => {
    const { reminded: _, ...r } = remindPatch(when, next);
    return r;
  };
  // У встречи нет матрицы: она про срочность и важность дел, а не созвонов
  const setKind = (kind: Draft["kind"]) => set(kind === "meeting" ? { kind, quadrant: null } : { kind });

  const [fileErr, setFileErr] = useState<string | null>(null);
  const addLink = () => {
    if (!newLink.trim()) return setBadLink(false);
    const u = normalizeUrl(newLink);
    if (!u) return setBadLink(true);
    setNewLink("");
    setBadLink(false);
    if (!(d.links ?? []).some((l) => l.url === u)) set({ links: [...(d.links ?? []), { url: u, title: "" }] });
  };
  // Выбор файлов уводит фокус из окна быстрого ввода: на это время не даём ему спрятаться и сбросить форму
  const pickFiles = async () => {
    setFileErr(null);
    await invoke("quick_picking", { on: true }).catch(() => {});
    try {
      const paths = await openDialog({ multiple: true, directory: false, title: "Прикрепить к задаче" });
      if (paths?.length) set({ files: [...new Set([...(d.files ?? []), ...paths])] });
    } catch (e) {
      setFileErr(String(e));
    } finally {
      await invoke("quick_picking", { on: false }).catch(() => {});
      getCurrentWindow().setFocus().catch(() => {});
    }
  };

  const submit = () => {
    // #тег и @Имя прямо в названии: убираем из текста, добавляем к выбранному в параметрах
    const q = parseQuick(title);
    const t = q.title || title.trim();
    if (!t) return titleRef.current?.focus();
    // Адрес, который напечатали, но не подтвердили Enter, тоже берём; на ссылку не похоже — не сохраняем молча
    const typed = newLink.trim() ? normalizeUrl(newLink) : null;
    if (newLink.trim() && !typed) {
      setMore(true);
      setBadLink(true);
      return linkRef.current?.focus();
    }
    const links = [...(d.links ?? []), ...(typed && !(d.links ?? []).some((l) => l.url === typed) ? [{ url: typed, title: "" }] : [])];
    const draft: Draft = { ...d, ...(links.length ? { links } : {}) };
    if (!meeting) delete draft.participants;
    if (q.title) {
      draft.tags = q.tags.reduce(addTagName, draft.tags ?? []);
      if (q.person && !draft.assigned_by) draft.assigned_by = canonicalPerson(q.person, props.people);
    }
    const rule = parseRule(draft.recurrence);
    if (!draft.due_date && (draft.start_time || draft.end_time || draft.remind_at || rule)) draft.due_date = rule ? firstOccurrence(rule, today()) : today();
    // «За 15 минут» считаем от окончательных даты и времени. Свой день и время напоминания остаются как выбрали
    if (draft.remind_at && draft.due_date && draft.remind_before != null) {
      draft.remind_at = remindAtFor(draft.due_date, anchorOf({ start_time: draft.start_time ?? null, end_time: draft.end_time }), draft.remind_before);
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
      {props.closable && <CloseX onClick={props.onCancel} />}
      <input ref={titleRef} className="field qi-title" placeholder="Что нужно сделать? #тег @кто назначил" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" spellCheck={false} />
      <textarea ref={noteRef} rows={2} className="field qi-note" placeholder="Заметка, если нужна" value={note} onChange={(e) => setNote(e.target.value)} />
      {more && (
        <div className="qi-more lines">
          <Line label="Статус">
            <div className="stage-seg">
              {NEW_STAGES.map((st) => (
                <button key={st.key} type="button" role="radio" aria-checked={(d.stage ?? "new") === st.key} className={(d.stage ?? "new") === st.key ? "on" : ""}
                  style={{ "--c": `var(--${st.accent})` } as React.CSSProperties} onClick={() => set({ stage: st.key === "new" ? undefined : st.key })}>
                  <Icon name={st.icon} size={12} /> {st.name}
                </button>
              ))}
            </div>
          </Line>
          <Line label="Тип"><KindSwitch value={d.kind ?? "task"} onChange={setKind} /></Line>
          <Line label="Важность"><PriorityPicker value={d.priority} onChange={(p) => set({ priority: p ?? undefined })} /></Line>
          {meeting ? (
            <>
              <Line label="Участники"><PeopleInput value={d.participants ?? []} people={props.people} onChange={(participants) => set({ participants })} /></Line>
            </>
          ) : (
            <Line label="Матрица"><QuadrantPicker value={d.quadrant ?? null} onChange={(q) => set({ quadrant: q })} /></Line>
          )}
          <Line label="Дата"><DateField inline value={d.due_date ?? null} onChange={(v) => set({ due_date: v, ...moveRemind({ due_date: v }) })} /></Line>
          <Line label="Время">
            <TimeRange start={d.start_time ?? null} end={d.end_time ?? null}
              onChange={(a, b) => set({ start_time: a, end_time: b, ...moveRemind({ start_time: a, end_time: b }) })} />
          </Line>
          <Line label="Напомнить">
            <RemindField defaultBefore={props.remindBefore} inline value={when}
              onChange={(p) => set({ ...("due_date" in p ? { due_date: p.due_date } : {}), remind_at: p.remind_at, remind_before: p.remind_before })} />
          </Line>
          <Line label="Повтор"><RepeatField inline value={d.recurrence ?? null} due={d.due_date ?? null} onChange={(v) => set({ recurrence: v })} /></Line>
          {(props.projects.length > 0 || props.onCreateProject) && (
            <Line label="Пространство">
              <SpacePicker projects={props.projects} value={d.project_id ?? null} onChange={(id) => set({ project_id: id })} onCreate={props.onCreateProject} />
            </Line>
          )}
          <Line label="Ссылки">
            <div className="qi-attach">
              {(d.links ?? []).map((l) => (
                <div key={l.url} className="att">
                  <Link2 size={14} className="att-ic" />
                  <span className="att-link raw" title={l.url}>{prettyUrl(l.url)}</span>
                  <button type="button" className="x show" title="Убрать ссылку" onClick={() => set({ links: (d.links ?? []).filter((x) => x.url !== l.url) })}><X size={12} /></button>
                </div>
              ))}
              <input ref={linkRef} className={`field qi-link ${badLink ? "bad" : ""}`} value={newLink} placeholder="Вставь ссылку и нажми Enter" spellCheck={false} autoComplete="off"
                onChange={(e) => (setNewLink(e.target.value), setBadLink(false))} onBlur={addLink}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.stopPropagation(), addLink())} />
              {badLink && <span className="hint">Не похоже на ссылку</span>}
            </div>
          </Line>
          <Line label="Файлы">
            <div className="qi-attach">
              {(d.files ?? []).map((p) => (
                <div key={p} className="att">
                  <FileText size={14} className="att-ic" />
                  <span className="att-name" title={p}>{p.split(/[\\/]/).pop()}</span>
                  <button type="button" className="x show" title="Убрать файл" onClick={() => set({ files: (d.files ?? []).filter((x) => x !== p) })}><X size={12} /></button>
                </div>
              ))}
              <div className="files-add">
                <button type="button" className="btn small" onClick={pickFiles} title="Выбрать файлы в Finder"><Paperclip size={13} /> Файл</button>
              </div>
              {fileErr && <span className="hint">{fileErr}</span>}
            </div>
          </Line>
          <Line label="Теги"><TagInput value={d.tags ?? []} tags={props.tags} onChange={(tags) => set({ tags })} /></Line>
          <Line label="От кого"><PersonInput value={d.assigned_by ?? null} people={props.people} onChange={(v) => set({ assigned_by: v })} /></Line>
        </div>
      )}
      <div className="qi-foot">
        <button type="button" className={`more-btn ${more ? "on" : ""}`} onClick={() => setMore((m) => !m)} data-tip="Дата, напоминание, пространство, теги" data-key="⌘E">
          {more ? "Скрыть параметры" : filled ? `Параметры · ${filled}` : "+ Дата, напоминание, теги…"}
        </button>
        <span className="grow" />
        <span>{d.stage === "done" ? "Сразу в «Готово»" : d.stage === "todo" ? "Сразу в «К выполнению»" : "Попадёт в «Новые»"}{props.profile && <> профиля <b className="qi-profile">{props.profile}</b></>}</span>
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

export type TaskPatch = Partial<Pick<Task, "title" | "note" | "priority" | "project_id" | "due_date" | "remind_at" | "reminded" | "start_time" | "end_time" | "quadrant" | "recurrence" | "assigned_by" | "remind_before" | "kind" | "waiting_for" | "waiting_until">>;

export function Details(props: {
  task: Task;
  projects: Project[];
  tags: Tag[];
  people: string[];
  allTasks: Task[]; // для поиска задачи в «Связях»
  onOpenTask: (id: number) => void;
  remindBefore: number;
  onPatch: (patch: TaskPatch) => void;
  onCreateProject?: (name: string) => Promise<number>;
  run: RunDb;
  onError: (e: string) => void;
  dropping?: boolean;
  onTriage: () => void;
  onToggleDone: () => void;
  onStage: (stage: Stage) => void; // переключатель статуса; «Готово» и «Отменено» спрашивают итоги
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { task: x, projects, onPatch } = props;
  const [title, setTitle] = useState(x.title);
  const [note, setNote] = useState(x.note);
  const [summary, setSummary] = useState(x.summary);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const sumRef = useRef<HTMLTextAreaElement>(null);
  useAutosize(noteRef, note);
  const closed = isClosed(x);
  // Поле итогов появляется при закрытии задачи: тогда тоже подогнать высоту
  useAutosize(sumRef, closed ? summary : "", 240);
  // Итоги могли записать в окне при закрытии, пока панель открыта
  useEffect(() => setSummary(x.summary), [x.summary]);
  const cancelled = isCancelled(x);
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
    const p: TaskPatch = (start || end) && !x.due_date ? { start_time: start, end_time: end, due_date: t } : { start_time: start, end_time: end };
    // От конца напоминание считается, только когда это срок (без начала)
    onPatch({ ...p, ...(anchorOf({ start_time: start, end_time: end }) !== anchorOf(x) ? remindPatch(x, p) : {}) });
  };
  const setRepeat = (json: string | null) => {
    const rule = parseRule(json);
    onPatch(rule && !x.due_date ? { recurrence: json, due_date: firstOccurrence(rule, t) } : { recurrence: json });
  };

  const asideRef = useRef<HTMLElement>(null);
  return (
    <aside ref={asideRef} className={`det split ${props.dropping ? "dropping" : ""}`}>
      {/* Прокручивается только содержимое, кнопки внизу живут отдельно и ничего не закрывают */}
      <div className="det-body">
      <div>
        <div className="lbl">{isInbox ? "Разбор" : locked ? "Завершена" : x.kind === "meeting" ? "Встреча" : "Задача"}</div>
        <textarea className="det-title" rows={1} value={title} disabled={locked}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
          onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }} />
      </div>

      <div className="det-created hint" data-tip={`Создана ${fmtStamp(x.created_at)}`}>Создана {fmtCreated(x.created_at).toLowerCase()}</div>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Статус</div>
        <StageSwitch task={x} onChange={props.onStage} />
      </fieldset>

      {!closed && (
        <fieldset className="det-sec" disabled={locked}>
          <div className="lbl">Жду{x.waiting_for ? null : <span className="opt"> ответа от человека</span>}</div>
          <WaitingField task={x} people={props.people} disabled={locked} onPatch={onPatch} />
        </fieldset>
      )}

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Кто назначил <span className="opt">необязательно</span></div>
        <PersonInput value={x.assigned_by} people={props.people} disabled={locked} onChange={(v) => onPatch({ assigned_by: v })} />
      </fieldset>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Связи{x.relations.length ? <span className="opt"> {x.relations.length}</span> : null}</div>
        <RelationsField task={x} all={props.allTasks} disabled={locked} run={props.run} onOpen={props.onOpenTask} />
      </fieldset>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Тип</div>
        <div className="seg"><KindSwitch value={x.kind} onChange={(kind) => onPatch({ kind })} /></div>
        {x.kind === "meeting" && (
          <>
            <div className="lbl sub-lbl">Участники{x.participants.length ? <span className="opt"> {x.participants.length}</span> : null}</div>
            <PeopleInput value={x.participants} people={props.people} disabled={locked}
              onChange={(names) => props.run(() => db.setTaskPeople(x.id, names))} />
          </>
        )}
      </fieldset>

      <fieldset className="det-sec" disabled={locked}>
        <div className="lbl">Важность</div>
        <PriorityPicker value={x.priority} onChange={(p) => onPatch({ priority: p ?? 0 })} />
        {(x.kind !== "meeting" || x.quadrant != null) && (
          <>
            <div className="lbl sub-lbl">Матрица Эйзенхауэра <span className="opt">необязательно</span></div>
            <QuadrantPicker value={x.quadrant} onChange={(q) => onPatch({ quadrant: q })} />
          </>
        )}
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

      {/* Итоги только у сделанных и отменённых, в том числе в «Завершённых»: их дописывают задним числом */}
      {closed && (
        <div className="det-sec">
          <div className="lbl">Итоги <span className="opt">{cancelled ? "почему отменил" : "что получилось"}</span></div>
          <textarea ref={sumRef} rows={1} className="field note sum-field" value={summary}
            placeholder={cancelled ? "Почему отменил" : "Что получилось, к чему пришли"}
            onChange={(e) => setSummary(e.target.value)} onBlur={() => summary !== x.summary && props.run(() => db.setSummary(x.id, summary.trim()))} />
        </div>
      )}
      </div>

      <div className="det-actions">
        {isInbox && <button className="cta" onClick={props.onTriage}>Разобрано ⏎</button>}
        {x.status === "active" && (
          <div className="row-btns">
            <button className="cta go" onClick={props.onToggleDone}>Сделано</button>
            <button className="btn" onClick={() => props.onStage("cancelled")}>Отменить</button>
          </div>
        )}
        {x.status === "done" && (
          <div className="row-btns">
            <button className="btn" onClick={props.onToggleDone}>Вернуть</button>
            <button className="cta go" onClick={props.onArchive}>В завершённые</button>
          </div>
        )}
        {locked && <button className="cta stand" onClick={props.onRestore}>Вернуть в работу</button>}
        <div className="hint">
          {isInbox
            ? x.project_id || x.due_date
              ? "После разбора задача уйдёт в нужные списки."
              : "Без пространства и даты задача после разбора окажется в «Скоро», в группе «Без даты»."
            : x.status === "done"
              ? `${x.recurrence && x.next_id ? "Следующий повтор уже в списке. " : ""}${cancelled ? "Отменённые" : "Сделанные"} сами уйдут в «Завершённые» завтра.`
              : x.recurrence ? "Когда отметишь сделанной или отменишь, появится следующий повтор." : null}
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

/** Статус задачи в панели: те же этапы, что столбцы канбана. Сделанную отменить нельзя, сначала её возвращают */
export function StageSwitch({ task, onChange }: { task: Task; onChange: (s: Stage) => void }) {
  const cur = stageOf(task);
  return (
    <div className="stage-seg" role="radiogroup" aria-label="Статус">
      {STAGES.map((s) => {
        const ok = canMove(task, s.key);
        return (
          <button key={s.key} type="button" role="radio" aria-checked={cur === s.key} disabled={!ok && cur !== s.key}
            className={cur === s.key ? "on" : ""} style={{ "--c": `var(--${s.accent})` } as React.CSSProperties}
            data-tip={!ok ? "Сделанную задачу нельзя отменить. Сначала верни её в работу" : s.key === cur ? undefined : s.hint}
            onClick={() => cur !== s.key && onChange(s.key)}>
            <Icon name={s.icon} size={12} /> {s.name}
          </button>
        );
      })}
    </div>
  );
}

/** Этап новой задачи в форме записи: отменить ещё не созданную задачу нельзя */
const NEW_STAGES = STAGES.filter((s) => s.key !== "cancelled") as (typeof STAGES[number] & { key: "new" | "todo" | "done" })[];

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
  ["N", "Записать задачу, а в разделе «Люди» человека"],
  ["⌘E", "Дата, напоминание, пространство, теги при записи"],
  ["#тег @Имя", "В названии: тег и кто назначил"],
  ["↑ ↓", "Выбрать задачу"],
  ["Enter", "Разобрать (в «Новые»)"],
  ["Space", "Сделано / вернуть"],
  ["1 … 5", "Важность: от минимальной до максимальной"],
  ["T", "Дата: сегодня"],
  ["⌘0", "Дашборд"],
  ["⌘1 … ⌘6", "Задачи, Новые, Сегодня, Скоро, Завершённые, Календарь"],
  ["⌘7", "Все пространства карточками"],
  ["⌘8", "Люди"],
  ["⌘F", "Поиск на этом экране: в списке, на доске, в календаре, в пространствах"],
  ["⌘P", "Найти пространство и перейти"],
  ["D W M  ← →", "Календарь: день, неделя, месяц, листать"],
  ["Клик в календаре", "Новая задача на это время, 30 минут"],
  ["Галочка, ⌘-клик", "Выбрать несколько, ⇧-клик выделяет подряд"],
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
        <CloseX onClick={onClose} />
        <div className="help-head">
          <h3>Сочетания клавиш</h3>
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

/** Чекбокс выбора нескольких записей: в «Задачах» и «Людях» один и тот же. Виден при наведении на строку, после первой отметки у всех строк */
export function PickBox(props: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <input type="checkbox" className="pickbox" checked={props.checked} aria-label={props.label}
      onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()} onChange={props.onToggle} />
  );
}
