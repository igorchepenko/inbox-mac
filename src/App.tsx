import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import * as db from "./db";
import type { Project, ProjectFields, Task } from "./db";
import { fmtDay, nowStamp, today } from "./dates";
import { listFor, progressFor, VIEWS, type ViewId } from "./views";
import { Details, Help, QuickForm, Ring, type TaskPatch } from "./components";
import { Icon } from "./icons";
import { ProjectDialog } from "./widgets";
import { CheckCheck, Keyboard, Link2, ListChecks, Paperclip, Pencil, Repeat } from "lucide-react";
import { fmtRange, QuadrantGlyph } from "./extras";
import { boardFor, dropTo, groupOf, layoutOf, type Group, type Layout } from "./boardOps";
import { BoardView, BulkPanel, GroupSwitch, LayoutSwitch, type Pick } from "./Board";
import { ensurePermission, fireDueReminders, maybeSendDigest } from "./reminders";
import { Settings } from "./Settings";
import { labelFromAccel, pref, quickKeyLabel, setQuickKeyLabel } from "./prefs";
import Home from "./home/Home";
import { KEY_HIDDEN, KEY_ORDER } from "./home/data";
import CalendarView from "./CalendarView";
import { toHHMM } from "./calendar";
import { PriorityIcon } from "./priority";
import { FIND_PROJECT_EVENT, Sidebar, viewIcon } from "./Sidebar";
import ProjectsPage from "./ProjectsPage";
import { Tooltips } from "./Tooltips";
import { QuickKeyBanner } from "./QuickKeyCheck";
import { usePanes } from "./panes";
import { Frame } from "./Frame";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  // null закрыто, "new" новый проект, иначе редактируемый
  const [projectDlg, setProjectDlg] = useState<Project | "new" | null>(null);
  const [view, setView] = useState<ViewId>("home");
  const { panes, setWidth: setPaneWidth, toggle: togglePane, reset: resetPane } = usePanes();
  const [sel, setSel] = useState<number | null>(null);
  // Выделение для массовых действий и режим «Выбрать», в котором клик добавляет задачу к выделению
  const [picked, setPicked] = useState<number[]>([]);
  const [selecting, setSelecting] = useState(false);
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

  const layout = layoutOf(view, settings);
  const list = useMemo(() => listFor(view, tasks), [view, tasks]);
  const group = groupOf(settings);
  const columns = useMemo(() => (layout === "board" ? boardFor(view, tasks, group) : null), [layout, view, tasks, group]);
  const ids = columns ? columns.flatMap((c) => c.items.map((i) => i.task.id)) : list.map((i) => i.task.id);
  const pickedTasks = tasks.filter((x) => picked.includes(x.id) && ids.includes(x.id));
  const bulk = selecting || pickedTasks.length > 1;
  const task = tasks.find((x) => x.id === sel && (view === "calendar" || ids.includes(x.id))) ?? null;

  // Когда выбранная задача ушла из списка (разобрана, сделана), выбираем ту, что встала на её место
  const lastIdx = useRef(0);
  useEffect(() => {
    if (view === "calendar") return; // в календаре выбор не зависит от списка
    const i = ids.indexOf(sel ?? -1);
    if (i >= 0) lastIdx.current = i;
    else setSel(ids[Math.min(lastIdx.current, ids.length - 1)] ?? null);
  }, [ids.join(","), sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearPick = () => (setPicked([]), setSelecting(false));
  const openView = (v: ViewId, from = tasks) => {
    setView(v);
    clearPick();
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
    openView(v, t);
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
  // Клик выбирает задачу, ⌘-клик или режим «Выбрать» добавляют к выделению, ⇧-клик берёт всё подряд от выбранной
  const pick: Pick = (id, m) => {
    if (m.shift && sel != null && ids.includes(sel)) {
      const [a, b] = [ids.indexOf(sel), ids.indexOf(id)].sort((x, y) => x - y);
      setPicked(ids.slice(a, b + 1));
      return;
    }
    if (m.meta || selecting) {
      const base = picked.length ? picked : sel != null && sel !== id ? [sel] : [];
      setPicked(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
    } else setPicked([]);
    setSel(id);
  };
  const setLayout = (l: Layout) => run(() => db.setSetting(`layout:${view}`, l));
  const setGroup = (g: Group) => run(() => db.setSetting("board.group", g));
  const moveCards = (moved: number[], col: string) =>
    run(async () => {
      for (const x of tasks.filter((x) => moved.includes(x.id))) await dropTo(x, group, col);
    });

  // Клик по пустому месту календаря: задача на этот день и время, название сразу выделено для правки
  const createAt = async (day: string, start: number | null, end: number | null) => {
    try {
      const id = await db.addTask("Новая задача", "", {
        due_date: day, start_time: start == null ? null : toHHMM(start), end_time: end == null ? null : toHHMM(end),
      });
      await reload();
      setSel(id);
      setTimeout(() => {
        const el = document.querySelector<HTMLTextAreaElement>(".det-title");
        el?.focus();
        el?.select();
      }, 50);
    } catch (e) {
      setError(String(e));
    }
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
  const lastRow = useRef<number | null>(null);
  live.current = { sel, tasks, busy: newOpen || !!projectDlg || helpOpen };
  useEffect(() => {
    // Над панелью задачи зона горит всё время, пока там курсор: решает панель целиком, а не то, что под курсором внутри неё.
    // Между строками списка остаётся последняя строка, иначе подсветка моргала бы на каждом зазоре.
    const targetAt = (pos: { x: number; y: number }) => {
      const el = document.elementFromPoint(pos.x / devicePixelRatio, pos.y / devicePixelRatio);
      const onPanel = !!el?.closest(".det");
      const row = onPanel ? null : el?.closest<HTMLElement>("[data-task-id]");
      if (row) lastRow.current = Number(row.dataset.taskId);
      const inList = !onPanel && !!el?.closest(".views");
      const id = onPanel ? live.current.sel : row ? Number(row.dataset.taskId) : inList ? lastRow.current ?? live.current.sel : live.current.sel;
      const t = live.current.tasks.find((x) => x.id === id);
      return { id: t && t.status !== "archived" && !live.current.busy ? t.id : null, onRow: !onPanel && (!!row || (inList && lastRow.current != null)) };
    };
    const un = getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      if (p.type === "leave") return (lastRow.current = null), setDropTarget(null);
      if (p.type === "enter") lastRow.current = null;
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
      if (e.metaKey && e.ctrlKey && e.code === "KeyS") return e.preventDefault(), togglePane("side");
      if (e.metaKey && e.altKey && e.code === "KeyI") return e.preventDefault(), togglePane("det");
      if (e.metaKey && e.code === "Digit0") return e.preventDefault(), openView("home");
      if (e.metaKey && e.code === "Digit6") return e.preventDefault(), openView("projects");
      if (e.metaKey && e.code === "KeyP") return e.preventDefault(), window.dispatchEvent(new Event(FIND_PROJECT_EVENT));
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
      if (e.metaKey && e.code === "KeyA") return e.preventDefault(), setPicked(ids);
      if (e.key === "Escape" && bulk) return clearPick();
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
        case "Digit4":
        case "Digit5":
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

  // Главная и страница проектов занимают всё место справа от меню, без панели деталей
  const wide = view === "home" || view === "projects";
  const current = VIEWS.find((v) => v.id === view);
  const project = view.startsWith("p:") ? projects.find((p) => `p:${p.id}` === view) : undefined;
  if (!wide && ((!current && !project && projects.length) || hidden(view))) queueMicrotask(() => openView("inbox"));
  const progress = progressFor(view, tasks);

  return (
    <div className={`app ${view === "home" ? "app-home" : view === "projects" ? "app-wide" : ""} ${panes.side.collapsed ? "side-off" : ""} ${panes.det.collapsed && !wide ? "det-off" : ""}`}
      style={{ "--side-w": `${panes.side.collapsed ? 0 : panes.side.width}px`, "--det-w": `${panes.det.collapsed ? 0 : panes.det.width}px` } as CSSProperties}>
      <div className="titlebar" data-tauri-drag-region />
      <Frame panes={panes} hasDetails={!wide} onWidth={setPaneWidth} onToggle={togglePane} onReset={resetPane} />
      <Sidebar view={view} tasks={tasks} projects={projects} settings={settings} onOpen={openView}
        onNewProject={() => setProjectDlg("new")} onEditProject={(p) => setProjectDlg(p)}
        onSettings={() => setSettingsOpen(true)} onShortcuts={() => setHelpOpen(true)}
        onSetting={(key, value) => {
          setSettings((st) => ({ ...st, [key]: value }));
          run(() => db.setSetting(key, value));
        }}
        onViewIcon={(id, icon) => run(() => db.setSetting(`icon:${id}`, icon))} />

      {view === "calendar" ? (
        <CalendarView tasks={tasks} projects={projects} selected={sel} onSelect={setSel}
          onToggle={(x) => run(() => (x.status === "done" ? db.reopenTask(x) : db.completeTask(x)))}
          onMove={(id, p) => {
            if (p.remind_at) ensurePermission();
            run(() => db.updateTask(id, p));
          }}
          onCreate={createAt} />
      ) : (
      <main className="main">
        {view === "projects" ? (
          <ProjectsPage projects={projects} tasks={tasks} onOpen={openView}
            onEdit={(p) => setProjectDlg(p)} onNew={() => setProjectDlg("new")} />
        ) : view === "home" ? (
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
            <p className="head-sub" data-tip={project?.description || undefined} data-tip-full="">{project?.description || progress?.subtitle || subtitleFor(view, list.length)}</p>
          </div>
          {project && (
            <button className="icon-btn" data-tip="Изменить проект" onClick={() => setProjectDlg(project)}>
              <Pencil size={13} /> Изменить
            </button>
          )}
          {columns && <GroupSwitch value={group} onChange={setGroup} />}
          <LayoutSwitch value={layout} onChange={setLayout} />
          <button className={`icon-btn ${selecting ? "on" : ""}`} data-tip="Выбрать несколько задач, ⌘-клик по строке" data-key="⌘A"
            onClick={() => (selecting ? clearPick() : (setSelecting(true), setPicked(sel != null ? [sel] : [])))}>
            <CheckCheck size={13} /> Выбрать
          </button>
          <button className="icon-btn" data-tip="Сочетания клавиш" data-key="⌘/" aria-label="Сочетания клавиш" onClick={() => setHelpOpen(true)}><Keyboard size={14} /></button>
        </header>

        {view !== "archive" && (
          <button className="add field" onClick={() => setNewOpen(true)}>
            + Записать задачу <kbd>N</kbd>
          </button>
        )}

        {error && <div className="error">Ошибка базы: {error}</div>}

        <div className={`views ${selecting ? "selecting" : ""}`}>
          {columns ? (
            <BoardView columns={columns} projects={projects} sel={sel} picked={picked}
              fileDrop={dropOnDetails ? null : dropTarget}
              onPick={pick} onToggle={toggleDone} onMove={moveCards} />
          ) : (
            <div className="list" role="listbox">
              {list.map(({ task: x, group }) => (
                <div key={x.id}>
                  {group && <div className="group">{group}</div>}
                  <TaskRow task={x} project={projects.find((p) => p.id === x.project_id)} selected={x.id === sel}
                    picked={picked.includes(x.id)} dropping={dropTarget === x.id && !dropOnDetails} onSelect={(m) => pick(x.id, m)} onToggle={() => toggleDone(x)} />
                </div>
              ))}
              {!list.length && <div className="empty">{emptyText(view)}</div>}
            </div>
          )}
        </div>
        </>)}
      </main>
      )}

      {wide ? null : bulk ? (
        <BulkPanel tasks={pickedTasks} total={ids.length} projects={projects} selecting={selecting} run={run}
          onSelectAll={() => setPicked(ids)} onClear={clearPick} />
      ) : task ? (
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
      <Tooltips />
      {!settingsOpen && <QuickKeyBanner error={shortcutError} onSettings={() => setSettingsOpen(true)} />}
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

function TaskRow(props: {
  task: Task;
  project?: Project;
  selected: boolean;
  picked: boolean;
  dropping?: boolean;
  onSelect: (mods: { meta: boolean; shift: boolean }) => void;
  onToggle: () => void;
}) {
  const { task: x, project } = props;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [props.selected]);
  const done = x.status === "done" || x.status === "archived";
  const overdue = x.status === "active" && !!x.due_date && x.due_date < today();
  return (
    <div ref={ref} role="option" aria-selected={props.selected} data-task-id={x.id}
      className={`row ${props.selected ? "sel" : ""} ${props.picked ? "picked" : ""} ${done ? "done" : ""} ${props.dropping ? "drop" : ""}`}
      onMouseDown={(e) => props.onSelect({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })}>
      <button className="chk" title={done ? "Вернуть" : "Сделано"} disabled={x.status === "archived"}
        onMouseDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), props.onToggle())} />
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
      {x.priority > 0 && !done && <PriorityIcon p={x.priority} />}
      {project && <span className="tag" style={{ background: `var(--${project.color})` }}>{project.name}</span>}
      {x.due_date && <span className={`meta ${overdue ? "overdue" : ""}`}>{fmtDay(x.due_date)}</span>}
    </div>
  );
}
