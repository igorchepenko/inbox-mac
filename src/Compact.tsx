import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ArrowUp, Settings as Gear } from "lucide-react";
import { addTask, loadProjects, updateSubtask, loadSettings, loadTasks, type Project, type Task } from "./db";
import { Icon } from "./icons";
import { Tooltips } from "./Tooltips";
import { compactItems, compactTabs, rowShown, zoomOf, dueLabel, listAccent, listIcon, listName, savedList, saveList } from "./compactLists";
import { countFor, type ViewId } from "./views";
import { stageOf, STAGES } from "./boardOps";
import { priorityName } from "./priority";
import { fmtDay, fmtStamp } from "./dates";
import { fmtCreated } from "./TaskBits";
import { describe, parseRule } from "./recurrence";
import { RELATION_NAMES } from "./relations";
import { currentZoom } from "./prefs";
import CompactSettings from "./CompactSettings";
import { RowMark, RowMeta } from "./CompactRow";
import "./compact.css";

/*
 * Окно компактного вида: открывается от значка у правого края экрана (src-tauri/src/compact.rs).
 * Сверху переключатель списков иконками, в строке задачи название и дата, при наведении карточка со всем,
 * что есть у задачи, внизу строка ввода: Enter записывает задачу в «Новые» с одним названием
 */

const hold = (on: boolean) => invoke("compact_hold", { on }).catch(() => {});

/** Ручки по краям окна: тянешь — окно меняет размер. Правый край прижат к значку, поэтому ручек справа нет */
const HANDLES = ["n", "s", "w", "nw", "sw"];

interface Hover {
  task: Task;
  top: number; // верх и низ строки в окне
  bottom: number;
}

export default function CompactApp() {
  const [view, setView] = useState<ViewId>(savedList);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [setup, setSetup] = useState(false); // страница настроек вместо списка
  const [hover, setHover] = useState<Hover | null>(null);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef(0);

  const reload = () =>
    Promise.all([loadTasks(), loadSettings(), loadProjects()])
      .then(([t, st, p]) => (setTasks(t), setSettings(st), setProjects(p), setError(null)))
      .catch((e) => setError(String(e)));

  useEffect(() => {
    reload();
    const un = [
      listen("compact-open", () => reload()),
      listen("tasks-changed", () => reload()),
      // Окно спряталось: карточку убираем, фокус из строки ввода снимаем, набранный текст остаётся
      listen("compact-hidden", () => (setHover(null), input.current?.blur())),
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      // Первый Esc уводит фокус из строки ввода, следующий закрывает окно
      if (document.activeElement === input.current) input.current?.blur();
      else invoke("compact_hide").catch(() => {});
    };
    addEventListener("keydown", onKey);
    return () => (removeEventListener("keydown", onKey), un.forEach((p) => p.then((f) => f())));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Пока пишешь задачу, окно не закрывается от ухода курсора
  useEffect(() => void hold(focused || text.trim() !== ""), [focused, text]);

  // Масштаб компактного окна: поверх размера из внешнего вида. --z нужен, чтобы прозрачный отступ под ручки оставался 10 px (PAD в compact.rs)
  const zoom = zoomOf(settings);
  const applyZoom = () => {
    const z = currentZoom() * zoom;
    document.documentElement.style.setProperty("--z", String(z));
    getCurrentWebview().setZoom(z).catch(() => {});
  };
  useEffect(applyZoom, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Внешний вид главного окна мог сбросить масштаб: при каждом показе окна ставим свой
    const un = listen("compact-open", () => window.setTimeout(applyZoom, 50));
    return () => void un.then((f) => f());
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (v: ViewId) => (setView(v), saveList(v), setHover(null), setSetup(false));

  const save = async () => {
    const title = text.trim();
    if (!title) return;
    try {
      await addTask(title, "");
      setText("");
      setNote("Записано в «Новые»");
      window.setTimeout(() => setNote(null), 2200);
      await emit("tasks-changed");
    } catch (e) {
      setError(String(e));
    }
  };

  const items = compactItems(view, tasks, settings);
  const tabs = compactTabs(settings, tasks, view);
  const show = rowShown(settings);
  const toggleSub = (id: number, done: boolean) => updateSubtask(id, { done: done ? 1 : 0 }).then(() => emit("tasks-changed"), (e) => setError(String(e)));
  const enter = (task: Task, el: HTMLElement) => {
    clearTimeout(timer.current);
    const r = el.getBoundingClientRect();
    // Короткая пауза: при движении мыши по списку карточки не мелькают
    timer.current = window.setTimeout(() => setHover({ task, top: r.top, bottom: r.bottom }), hover ? 60 : 280);
  };
  const leave = () => (clearTimeout(timer.current), setHover(null));

  return (
    <div className="cv-root">
      {HANDLES.map((h) => (
        <div key={h} className={`cv-grip g-${h}`} onPointerDown={(e) => (e.preventDefault(), invoke("compact_resize", { dir: h }).catch(() => {}))} />
      ))}
      <div className="cv-card">
        <nav className="cv-tabs" aria-label="Списки">
          {tabs.map((v) => {
            const n = countFor(v, tasks);
            return (
              <button key={v} type="button" className={`cv-tab${v === view ? " on" : ""}`} style={{ ["--acc" as string]: `var(--${listAccent(v)})` }}
                data-tip={listName(v)} aria-label={listName(v)} aria-pressed={v === view} onClick={() => pick(v)}>
                <span className="cv-ic"><Icon name={listIcon(v, settings)} size={15} /></span>
                {n > 0 && <span className="cv-n">{n > 99 ? "99+" : n}</span>}
              </button>
            );
          })}
          <button type="button" className={`cv-tab cv-gear${setup ? " on" : ""}`} data-tip="Настройки компактного вида" aria-label="Настройки компактного вида"
            aria-pressed={setup} onClick={() => (setSetup(!setup), setHover(null))}>
            <Gear size={15} />
          </button>
        </nav>
        {setup ? (
          <CompactSettings settings={settings} onBack={() => setSetup(false)} onChanged={reload} />
        ) : (
          <>
        <div className="cv-head" style={{ ["--acc" as string]: `var(--${listAccent(view)})` }}>
          <span className="cv-head-ic"><Icon name={listIcon(view, settings)} size={15} /></span>
          <span className="cv-title">{listName(view)}</span>
          <span className="cv-count">{countFor(view, tasks) || ""}</span>
        </div>
        <div className="cv-list" onScroll={leave}>
          {items.length === 0 && <div className="cv-empty">{error ? `Не загрузилось: ${error}` : "Здесь пусто"}</div>}
          {items.map(({ task, group }) => {
            return (
              <div key={task.id}>
                {group && <div className="cv-group">{group}</div>}
                <div role="button" tabIndex={0} className={`cv-row${hover?.task.id === task.id ? " hot" : ""}`}
                  onMouseEnter={(e) => enter(task, e.currentTarget)} onMouseLeave={leave}
                  onClick={() => invoke("compact_open_task", { id: task.id }).catch(() => {})}
                  onKeyDown={(e) => e.key === "Enter" && invoke("compact_open_task", { id: task.id }).catch(() => {})}>
                  <RowMark task={task} show={show} />
                  <span className="cv-name">{task.title || "Без названия"}</span>
                  <RowMeta task={task} project={projects.find((p) => p.id === task.project_id)} show={show} onSub={toggleSub} />
                </div>
              </div>
            );
          })}
        </div>
          </>
        )}
        <form className="cv-add" onSubmit={(e) => (e.preventDefault(), save())}>
          <input ref={input} className="field cv-input" value={text} placeholder="Новая задача" spellCheck={false} maxLength={500}
            onChange={(e) => setText(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
          <button type="submit" className="cv-send" disabled={!text.trim()} data-tip="Записать в «Новые»" aria-label="Записать в «Новые»">
            <ArrowUp size={15} strokeWidth={2.4} />
          </button>
        </form>
        {(note || (error && items.length > 0)) && <div className={`cv-note${error ? " err" : ""}`}>{error ? `Не сохранилось: ${error}` : note}</div>}
      </div>
      {hover && <TaskCard hover={hover} projects={projects} />}
      <Tooltips />
    </div>
  );
}

/** Всплывающая карточка задачи: под строкой, а если внизу не хватает места — над ней */
function TaskCard({ hover, projects }: { hover: Hover; projects: Project[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const h = el.offsetHeight;
    const room = window.innerHeight - 14;
    const below = hover.bottom + 4;
    const top = below + h <= room ? below : Math.max(14, hover.top - 4 - h);
    setPos({ top });
  }, [hover]);
  const x = hover.task;
  const space = projects.find((p) => p.id === x.project_id)?.name;
  const stage = STAGES.find((s) => s.key === stageOf(x));
  const rule = parseRule(x.recurrence);
  const subDone = x.subtasks.filter((s) => s.done).length;
  const rows: [string, string][] = [];
  const due = dueLabel(x);
  if (due) rows.push([x.kind === "meeting" ? "Когда" : "Срок", due]);
  if (x.priority) rows.push(["Важность", priorityName(x.priority)]);
  if (space) rows.push(["Пространство", space]);
  if (x.waiting_for) rows.push(["Жду", x.waiting_until ? `${x.waiting_for}, напомнить ${fmtDay(x.waiting_until).toLowerCase()}` : x.waiting_for]);
  if (x.assigned_by) rows.push(["Кто назначил", x.assigned_by]);
  if (x.participants.length) rows.push(["Участники", x.participants.join(", ")]);
  if (x.remind_at) rows.push(["Напоминание", fmtStamp(x.remind_at)]);
  if (rule) rows.push(["Повтор", describe(rule)]);
  if (x.links.length) rows.push(["Ссылки", x.links.map((l) => l.title || l.url).join(", ")]);
  if (x.files.length) rows.push(["Файлы", x.files.map((f) => f.name).join(", ")]);
  if (x.relations.length) rows.push(["Связи", x.relations.map((r) => `${RELATION_NAMES[r.kind].toLowerCase()}: ${r.other_title}`).join("; ")]);
  return (
    <div ref={box} className="cv-pop" style={{ top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }} role="tooltip">
      <div className="cv-pop-title">{x.title || "Без названия"}</div>
      <div className="cv-pop-chips">
        {stage && <span className="cv-chip" style={{ ["--acc" as string]: `var(--${stage.accent})` }}>{stage.name}</span>}
        {x.kind === "meeting" && <span className="cv-chip">Встреча</span>}
        {x.tags.map((g) => (
          <span key={g.id} className="cv-chip tag">#{g.name}</span>
        ))}
      </div>
      {rows.length > 0 && (
        <dl className="cv-pop-rows">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {x.subtasks.length > 0 && (
        <div className="cv-pop-sub">
          <div className="cv-pop-lbl">Чек-лист {subDone}/{x.subtasks.length}</div>
          {x.subtasks.slice(0, 6).map((s) => (
            <div key={s.id} className={`cv-pop-item${s.done ? " done" : ""}`}>{s.done ? "✓" : "○"} {s.title}</div>
          ))}
          {x.subtasks.length > 6 && <div className="cv-pop-more">и ещё {x.subtasks.length - 6}</div>}
        </div>
      )}
      {x.note.trim() && <div className="cv-pop-note">{x.note.trim()}</div>}
      <div className="cv-pop-foot">Создана {fmtCreated(x.created_at).toLowerCase()}</div>
    </div>
  );
}
