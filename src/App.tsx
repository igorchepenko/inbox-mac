import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import * as db from "./db";
import type { Project, ProjectFields, Task } from "./db";
import { fmtDay, nowStamp, today } from "./dates";
import { countFor, listFor, progressFor, VIEWS, type ViewId } from "./views";
import { Details, Help, QuickForm, Ring, type TaskPatch } from "./components";
import { Icon } from "./icons";
import { IconGrid, Popover, ProjectDialog, ThemeSwitch } from "./widgets";
import { Link2, ListChecks, Paperclip, Pencil, Repeat, Settings as Gear } from "lucide-react";
import { fmtRange, QuadrantGlyph } from "./extras";
import { ensurePermission, fireDueReminders, maybeSendDigest } from "./reminders";
import { Settings } from "./Settings";
import { labelFromAccel, pref, quickKeyLabel, setQuickKeyLabel } from "./prefs";
import Home, { HomeIcon } from "./home/Home";
import { KEY_HIDDEN, KEY_ORDER } from "./home/data";
import CalendarView from "./CalendarView";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  // null закрыто, "new" новый проект, иначе редактируемый
  const [projectDlg, setProjectDlg] = useState<Project | "new" | null>(null);
  const [view, setView] = useState<ViewId>("home");
  const [sel, setSel] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const settingsRef = useRef<Record<string, string>>({});
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const reload = useCallback(async () => {
    try {
      await db.archiveOldDone();
      const [t, p, st] = await Promise.all([db.loadTasks(), db.loadProjects(), db.loadSettings()]);
      setTasks(t);
      setProjects(p);
      setSettings(st);
      settingsRef.current = st;
      setError(null);
      if (!started.current) {
        started.current = true;
        startUp(t, st);
      }
      return t;
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  // Действие с базой, затем перечитать всё. Задач у одного человека сотни, это мгновенно
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        setError(String(e));
      }
      await reload();
    },
    [reload],
  );

  useEffect(() => {
    reload();
    // Задачи из окна быстрого ввода и «Настройки…» из меню приложения
    const un = [listen("tasks-changed", () => reload()), listen("open-settings", () => setSettingsOpen(true))];
    // Раз в 30 секунд: напоминания, утренняя сводка, смена дня, архив вчерашних сделанных
    const id = setInterval(async () => {
      const t = await reload();
      const fired = await fireDueReminders(t, settingsRef.current);
      if ((await maybeSendDigest(t, settingsRef.current)) || fired) await reload();
      setTick((n) => n + 1);
    }, 30_000);
    return () => {
      clearInterval(id);
      un.forEach((p) => p.then((f) => f()));
    };
  }, [reload]);

  const list = useMemo(() => listFor(view, tasks), [view, tasks]);
  const ids = list.map((i) => i.task.id);
  const task = tasks.find((x) => x.id === sel && (view === "calendar" || ids.includes(x.id))) ?? null;

  // Когда выбранная задача ушла из списка (разобрана, сделана), выбираем ту, что встала на её место
  const lastIdx = useRef(0);
  useEffect(() => {
    if (view === "calendar") return; // в календаре выбор не зависит от списка
    const i = ids.indexOf(sel ?? -1);
    if (i >= 0) lastIdx.current = i;
    else setSel(ids[Math.min(lastIdx.current, ids.length - 1)] ?? null);
  }, [ids.join(","), sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const openView = (v: ViewId, from = tasks) => {
    setView(v);
    lastIdx.current = 0;
    setSel(listFor(v, from)[0]?.task.id ?? null);
    db.setSetting("last.view", v).catch(() => {}); // для начального экрана «Где остановился»
  };

  const hidden = (v: ViewId) => v !== "inbox" && settings[`hidden:${v}`] === "1";

  // Сочетание быстрого ввода: Rust при запуске занимает ⌥Space, здесь меняем на сохранённое в настройках
  const applyShortcut = async (accel: string): Promise<string | null> => {
    try {
      await invoke("set_quick_shortcut", { accel, label: labelFromAccel(accel) });
      setQuickKeyLabel(accel);
      setShortcutError(null);
      return null;
    } catch (e) {
      return String(e);
    }
  };

  // Первая загрузка: начальный экран и сочетание из настроек
  function startUp(t: Task[], st: Record<string, string>) {
    const start = pref(st, "start.view");
    const v = (start === "last" ? st["last.view"] ?? "inbox" : start) as ViewId;
    // Удалённый проект или спрятанный список сам сменится на «На разбор»
    if (v !== "inbox") openView(v, t);
    const accel = pref(st, "quick.shortcut");
    if (accel !== "Alt+Space") applyShortcut(accel).then((err) => err && setShortcutError(`Не удалось занять ${labelFromAccel(accel)}: ${err}`));
  }

  const patch = (id: number, p: TaskPatch) => {
    if (p.remind_at) ensurePermission();
    run(() => db.updateTask(id, p));
  };
  const triage = (x: Task) => run(() => db.updateTask(x.id, { status: "active", triaged_at: nowStamp() }));
  // Через completeTask: у повторяющейся задачи она создаёт следующий повтор, reopenTask его убирает
  const toggleDone = (x: Task) => run(() => (x.status === "done" ? db.reopenTask(x) : db.completeTask(x)));
  const archive = (x: Task) => run(() => db.updateTask(x.id, { status: "archived", done_at: x.done_at ?? nowStamp() }));
  const restore = (x: Task) => run(() => db.updateTask(x.id, { status: "active", done_at: null }));

  // С главной: отметка учитывает повторы, перенос просроченного сохраняет время напоминания
  const toggleFromHome = (x: Task) => run(() => (x.status === "done" ? db.reopenTask(x) : db.completeTask(x)));
  const moveToToday = (xs: Task[]) =>
    run(async () => {
      for (const x of xs) {
        const rt = x.remind_at?.slice(11, 16);
        await db.updateTask(x.id, rt ? { due_date: today(), remind_at: `${today()}T${rt}`, reminded: 0 } : { due_date: today() });
      }
    });
  // Задача с главной открывается в своём списке
  const openTask = (x: Task) => {
    const t = today();
    const v: ViewId = x.status === "inbox" ? "inbox" : x.status === "archived" ? "archive"
      : x.due_date && x.due_date <= t ? "today" : x.status === "done" ? "today" : "soon";
    setView(v);
    setSel(x.id);
  };

  const saveNew = (title: string, note: string, draft: db.Draft) => {
    setNewOpen(false);
    if (draft.remind_at) ensurePermission();
    (async () => {
      try {
        const id = await db.addTask(title, note, draft);
        await reload();
        setView("inbox");
        setSel(id);
      } catch (e) {
        setError(String(e));
      }
    })();
  };

  // Файлы из Finder: брошенные на строку прикрепляются к этой задаче, брошенные в другое место — к выбранной
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [dropOnDetails, setDropOnDetails] = useState(false);
  const live = useRef({ sel, tasks, busy: false });
  live.current = { sel, tasks, busy: newOpen || !!projectDlg || helpOpen };
  useEffect(() => {
    const targetAt = (pos: { x: number; y: number }) => {
      const el = document.elementFromPoint(pos.x / devicePixelRatio, pos.y / devicePixelRatio);
      const row = el?.closest<HTMLElement>("[data-task-id]");
      const id = row ? Number(row.dataset.taskId) : live.current.sel;
      const t = live.current.tasks.find((x) => x.id === id);
      return { id: t && t.status !== "archived" && !live.current.busy ? t.id : null, onRow: !!row };
    };
    const un = getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      if (p.type === "leave") return setDropTarget(null);
      const { id, onRow } = targetAt(p.position);
      if (p.type === "drop") {
        setDropTarget(null);
        if (id != null && p.paths.length) {
          setSel(id);
          run(() => db.attachFiles(id, p.paths));
        }
        return;
      }
      setDropTarget(id);
      setDropOnDetails(!onRow);
    });
    return () => void un.then((f) => f());
  }, [run]);

  // Клавиатура
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.code === "Comma") return e.preventDefault(), setSettingsOpen(true);
      if (newOpen || projectDlg || settingsOpen) return; // формы сами ловят Enter и Esc
      if (helpOpen) {
        if (e.key === "Escape" || (e.metaKey && e.code === "Slash")) setHelpOpen(false);
        return;
      }
      if (e.metaKey && e.code === "Slash") return e.preventDefault(), setHelpOpen(true);
      if (e.metaKey && e.code === "Digit0") return e.preventDefault(), openView("home");
      if (e.metaKey && /^Digit[1-5]$/.test(e.code)) {
        e.preventDefault();
        const v = VIEWS[Number(e.code.slice(5)) - 1].id;
        if (!hidden(v)) openView(v);
        return;
      }
      const el = document.activeElement as HTMLElement | null;
      if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) {
        if (e.key === "Escape") el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const i = ids.indexOf(sel ?? -1);
      // e.code не зависит от раскладки: N работает и на русской
      switch (e.code) {
        case "KeyN":
          e.preventDefault();
          setNewOpen(true);
          break;
        case "ArrowDown":
        case "KeyJ":
          e.preventDefault();
          if (ids[i + 1] != null) setSel(ids[i + 1]);
          break;
        case "ArrowUp":
        case "KeyK":
          e.preventDefault();
          if (i > 0) setSel(ids[i - 1]);
          break;
        case "Enter":
          if (task?.status === "inbox") triage(task);
          break;
        case "Space":
          e.preventDefault();
          if (task && task.status !== "archived") toggleDone(task);
          break;
        case "Digit1":
        case "Digit2":
        case "Digit3":
          if (task && task.status !== "archived") patch(task.id, { priority: Number(e.code.slice(5)) });
          break;
        case "KeyT":
          if (task && task.status !== "archived") {
            const rt = task.remind_at?.slice(11, 16);
            patch(task.id, rt ? { due_date: today(), remind_at: `${today()}T${rt}`, reminded: 0 } : { due_date: today() });
          }
          break;
        case "Escape":
          (document.activeElement as HTMLElement | null)?.blur();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const current = VIEWS.find((v) => v.id === view);
  const project = view.startsWith("p:") ? projects.find((p) => `p:${p.id}` === view) : undefined;
  if (view !== "home" && ((!current && !project && projects.length) || hidden(view))) queueMicrotask(() => openView("inbox"));
  const progress = progressFor(view, tasks);

  return (
    <div className={`app ${view === "home" ? "app-home" : ""}`}>
      <div className="titlebar" data-tauri-drag-region />
      <Sidebar view={view} tasks={tasks} projects={projects} settings={settings} onOpen={openView}
        onNewProject={() => setProjectDlg("new")} onEditProject={(p) => setProjectDlg(p)}
        onSettings={() => setSettingsOpen(true)}
        onViewIcon={(id, icon) => run(() => db.setSetting(`icon:${id}`, icon))} />

      {view === "calendar" ? (
        <CalendarView tasks={tasks} projects={projects} selected={sel} onSelect={setSel}
          onToggle={(x) => run(() => (x.status === "done" ? db.reopenTask(x) : db.completeTask(x)))}
          onMove={(id, p) => {
            if (p.remind_at) ensurePermission();
            run(() => db.updateTask(id, p));
          }} />
      ) : (
      <main className="main">
        {view === "home" ? (
          <Home tasks={tasks} projects={projects} settings={settings}
            onOpenInbox={() => openView("inbox")} onOpenToday={() => openView("today")}
            onOpenTask={openTask} onToggle={toggleFromHome} onMoveToToday={moveToToday}
            onNewProject={() => setProjectDlg("new")}
            onSaveLayout={(order, hidden) => {
              setSettings((s) => ({ ...s, [KEY_ORDER]: JSON.stringify(order), [KEY_HIDDEN]: JSON.stringify(hidden) }));
              run(async () => {
                await db.setSetting(KEY_ORDER, JSON.stringify(order));
                await db.setSetting(KEY_HIDDEN, JSON.stringify(hidden));
              });
            }} />
        ) : (<>
        <header className="head" data-tauri-drag-region>
          {progress ? <Ring fraction={progress.fraction} accent={progress.accent} count={progress.count} /> : (
            <span className="head-icon" style={{ color: `var(--${project?.color ?? current?.accent ?? "muted"})` }}>
              <Icon name={project?.icon ?? viewIcon(current?.id ?? "inbox", settings)} size={24} />
            </span>
          )}
          <div className="head-text">
            <h2>{project?.name ?? current?.name ?? ""}</h2>
            <p>{project?.description || progress?.subtitle || subtitleFor(view, list.length)}</p>
          </div>
          {project && (
            <button className="icon-btn" title="Изменить проект" onClick={() => setProjectDlg(project)}>
              <Pencil size={13} /> Изменить
            </button>
          )}
          <button className="icon-btn" title="Клавиши (⌘/)" onClick={() => setHelpOpen(true)}>⌘/</button>
        </header>

        {view !== "archive" && (
          <button className="add field" onClick={() => setNewOpen(true)}>
            + Записать задачу <kbd>N</kbd>
          </button>
        )}

        {error && <div className="error">Ошибка базы: {error}</div>}

        <div className="list" role="listbox">
          {list.map(({ task: x, group }) => (
            <div key={x.id}>
              {group && <div className="group">{group}</div>}
              <TaskRow task={x} project={projects.find((p) => p.id === x.project_id)} selected={x.id === sel}
                dropping={dropTarget === x.id && !dropOnDetails}
                onSelect={() => setSel(x.id)} onToggle={() => toggleDone(x)} />
            </div>
          ))}
          {!list.length && <div className="empty">{emptyText(view)}</div>}
        </div>
        </>)}
      </main>
      )}

      {view === "home" ? null : task ? (
        <Details key={task.id} task={task} projects={projects}
          onPatch={(p) => patch(task.id, p)} run={run} onError={setError}
          dropping={dropTarget === task.id && dropOnDetails}
          onTriage={() => triage(task)} onToggleDone={() => toggleDone(task)}
          onArchive={() => archive(task)} onRestore={() => restore(task)}
          onDelete={() => run(() => db.deleteTask(task.id))} />
      ) : (
        <aside className="det"><div className="hint">Выбери задачу, чтобы увидеть детали.</div></aside>
      )}

      {newOpen && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setNewOpen(false)}>
          <QuickForm projects={projects} onSave={saveNew} onCancel={() => setNewOpen(false)} />
        </div>
      )}
      {helpOpen && <Help onClose={() => setHelpOpen(false)} />}
      {settingsOpen && (
        <Settings settings={settings} shortcutError={shortcutError} onClose={() => setSettingsOpen(false)}
          onSet={(key, value) => run(() => db.setSetting(key, value))}
          onQuickShortcut={async (accel) => {
            const err = await applyShortcut(accel);
            if (!err) await run(() => db.setSetting("quick.shortcut", accel));
            return err;
          }} />
      )}
      {projectDlg && (
        <ProjectDialog
          initial={projectDlg === "new" ? undefined : projectDlg}
          onClose={() => setProjectDlg(null)}
          onSave={(fields: ProjectFields) => {
            const target = projectDlg;
            setProjectDlg(null);
            run(() => (target === "new" ? db.addProject(fields, projects.length + 1) : db.updateProject(target.id, fields)));
          }}
          onDelete={projectDlg === "new" ? undefined : () => {
            const id = projectDlg.id;
            setProjectDlg(null);
            run(() => db.deleteProject(id));
          }}
        />
      )}
    </div>
  );
}

function subtitleFor(view: ViewId, n: number): string {
  if (view === "archive") return n ? `${n} в архиве` : "";
  if (view === "soon") return n ? "Запланированное на будущее и разобранное без даты" : "";
  return n ? `${n} в работе` : "";
}

function emptyText(view: ViewId): string {
  if (view === "inbox") return `Здесь пусто. Нажми ${quickKeyLabel()} в любом приложении, чтобы записать задачу.`;
  if (view === "today") return "На сегодня ничего. Поставь дату «Сегодня» при разборе.";
  if (view === "archive") return "Сделанные задачи попадают сюда на следующий день.";
  return "Здесь пока ничего нет.";
}

function viewIcon(id: ViewId, settings: Record<string, string>): string {
  return settings[`icon:${id}`] ?? VIEWS.find((v) => v.id === id)?.icon ?? "folder";
}

function Sidebar(props: {
  view: ViewId;
  tasks: Task[];
  projects: Project[];
  settings: Record<string, string>;
  onOpen: (v: ViewId) => void;
  onNewProject: () => void;
  onEditProject: (p: Project) => void;
  onViewIcon: (id: ViewId, icon: string) => void;
  onSettings: () => void;
}) {
  // Пункт меню, у которого сейчас открыт выбор иконки
  const [picker, setPicker] = useState<{ id: ViewId; el: HTMLElement } | null>(null);
  const item = (id: ViewId, label: string, accent: string, icon: string, onIcon: (el: HTMLElement) => void) => {
    const n = countFor(id, props.tasks);
    return (
      <div key={id} className={`nav ${props.view === id ? "on" : ""}`} onClick={() => props.onOpen(id)} role="button">
        <button className="nav-icon" title="Сменить иконку" style={{ color: `var(--${accent})` }}
          onClick={(e) => (e.stopPropagation(), onIcon(e.currentTarget))}>
          <Icon name={icon} size={15} />
        </button>
        <span className="nav-name">{label}</span>
        <span className="n">{n || ""}</span>
      </div>
    );
  };
  const pickerView = picker && VIEWS.find((v) => v.id === picker.id);
  return (
    <nav className="side">
      <div className={`nav ${props.view === "home" ? "on" : ""}`} onClick={() => props.onOpen("home")} role="button">
        <span className="nav-icon"><HomeIcon /></span>
        <span className="nav-name">Главная</span>
      </div>
      {VIEWS.filter((v) => v.id === "inbox" || props.settings[`hidden:${v.id}`] !== "1").map((v) => item(v.id, v.name, v.accent, viewIcon(v.id, props.settings), (el) => setPicker({ id: v.id, el })))}
      <div className="sec">Проекты</div>
      {props.projects.map((p) => item(`p:${p.id}`, p.name, p.color, p.icon, () => props.onEditProject(p)))}
      <button className="nav add-project" onClick={props.onNewProject}>+ Новый проект</button>
      <div className="side-foot">
        <ThemeSwitch />
        <button className="gear" title="Настройки (⌘,)" onClick={props.onSettings}><Gear size={15} /></button>
      </div>
      {picker && pickerView && (
        <Popover anchor={picker.el} onClose={() => setPicker(null)} width={232}>
          <div className="lbl">Иконка для «{pickerView.name}»</div>
          <IconGrid value={viewIcon(picker.id, props.settings)} accent={pickerView.accent}
            onPick={(icon) => (props.onViewIcon(picker.id, icon), setPicker(null))} />
        </Popover>
      )}
    </nav>
  );
}

function TaskRow(props: { task: Task; project?: Project; selected: boolean; dropping?: boolean; onSelect: () => void; onToggle: () => void }) {
  const { task: x, project } = props;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [props.selected]);
  const done = x.status === "done" || x.status === "archived";
  const overdue = x.status === "active" && !!x.due_date && x.due_date < today();
  return (
    <div ref={ref} role="option" aria-selected={props.selected} data-task-id={x.id}
      className={`row ${props.selected ? "sel" : ""} ${done ? "done" : ""} ${props.dropping ? "drop" : ""}`}
      onMouseDown={props.onSelect}>
      <button className="chk" title={done ? "Вернуть" : "Сделано"} disabled={x.status === "archived"}
        onClick={(e) => (e.stopPropagation(), props.onToggle())} />
      <span className="t">{x.title}</span>
      {x.subtasks.length > 0 && (
        <span className="meta badge" title="Чеклист"><ListChecks size={12} /> {x.subtasks.filter((s) => s.done).length}/{x.subtasks.length}</span>
      )}
      {x.links.length > 0 && <span className="meta badge" title="Ссылки"><Link2 size={12} />{x.links.length > 1 ? ` ${x.links.length}` : ""}</span>}
      {x.files.length > 0 && <span className="meta badge" title="Файлы"><Paperclip size={12} />{x.files.length > 1 ? ` ${x.files.length}` : ""}</span>}
      {x.recurrence && !done && <span className="meta badge" title="Повторяется"><Repeat size={12} /></span>}
      {x.quadrant && !done && <QuadrantGlyph q={x.quadrant} />}
      {x.start_time && <span className="meta" title="Время">{fmtRange(x.start_time, x.end_time)}</span>}
      {x.remind_at && !x.reminded && !done && <span className="meta" title="Напоминание">⏰ {x.remind_at.slice(11, 16)}</span>}
      {x.priority === 3 && !done && <span className="tag" style={{ background: "var(--move)" }}>!</span>}
      {project && <span className="tag" style={{ background: `var(--${project.color})` }}>{project.name}</span>}
      {x.due_date && <span className={`meta ${overdue ? "overdue" : ""}`}>{fmtDay(x.due_date)}</span>}
    </div>
  );
}
