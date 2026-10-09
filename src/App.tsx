import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as db from "./db";
import type { Accent, Project, Task } from "./db";
import { fmtDay, nowStamp, today } from "./dates";
import { countFor, listFor, progressFor, VIEWS, type ViewId } from "./views";
import { Details, Help, QuickForm, Ring, type TaskPatch } from "./components";
import { ensurePermission, fireDueReminders } from "./reminders";

const ACCENTS: Accent[] = ["move", "stand", "exercise"];

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [view, setView] = useState<ViewId>("inbox");
  const [sel, setSel] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const reload = useCallback(async () => {
    try {
      await db.archiveOldDone();
      const [t, p] = await Promise.all([db.loadTasks(), db.loadProjects()]);
      setTasks(t);
      setProjects(p);
      setError(null);
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
    // Задачи из окна быстрого ввода
    const un = listen("tasks-changed", () => reload());
    // Раз в 30 секунд: напоминания, смена дня, архив вчерашних сделанных
    const id = setInterval(async () => {
      const t = await reload();
      if (await fireDueReminders(t)) await reload();
      setTick((n) => n + 1);
    }, 30_000);
    return () => {
      clearInterval(id);
      un.then((f) => f());
    };
  }, [reload]);

  const list = useMemo(() => listFor(view, tasks), [view, tasks]);
  const ids = list.map((i) => i.task.id);
  const task = tasks.find((x) => x.id === sel && ids.includes(x.id)) ?? null;

  // Когда выбранная задача ушла из списка (разобрана, сделана), выбираем ту, что встала на её место
  const lastIdx = useRef(0);
  useEffect(() => {
    const i = ids.indexOf(sel ?? -1);
    if (i >= 0) lastIdx.current = i;
    else setSel(ids[Math.min(lastIdx.current, ids.length - 1)] ?? null);
  }, [ids.join(","), sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const openView = (v: ViewId) => {
    setView(v);
    lastIdx.current = 0;
    setSel(listFor(v, tasks)[0]?.task.id ?? null);
  };

  const patch = (id: number, p: TaskPatch) => {
    if (p.remind_at) ensurePermission();
    run(() => db.updateTask(id, p));
  };
  const triage = (x: Task) => run(() => db.updateTask(x.id, { status: "active", triaged_at: nowStamp() }));
  const toggleDone = (x: Task) =>
    run(() =>
      db.updateTask(x.id, x.status === "done" ? { status: "active", done_at: null } : { status: "done", done_at: nowStamp() }),
    );
  const archive = (x: Task) => run(() => db.updateTask(x.id, { status: "archived", done_at: x.done_at ?? nowStamp() }));
  const restore = (x: Task) => run(() => db.updateTask(x.id, { status: "active", done_at: null }));

  const saveNew = (title: string, note: string) => {
    setNewOpen(false);
    (async () => {
      try {
        const id = await db.addTask(title, note);
        await reload();
        setView("inbox");
        setSel(id);
      } catch (e) {
        setError(String(e));
      }
    })();
  };

  // Клавиатура
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (newOpen) return; // форма ввода сама ловит Enter и Esc
      if (helpOpen) {
        if (e.key === "Escape" || (e.metaKey && e.code === "Slash")) setHelpOpen(false);
        return;
      }
      if (e.metaKey && e.code === "Slash") return e.preventDefault(), setHelpOpen(true);
      if (e.metaKey && /^Digit[1-4]$/.test(e.code)) return e.preventDefault(), openView(VIEWS[Number(e.code.slice(5)) - 1].id);
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
  if (!current && !project && projects.length) queueMicrotask(() => openView("inbox"));
  const progress = progressFor(view, tasks);

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region />
      <Sidebar view={view} tasks={tasks} projects={projects} onOpen={openView}
        onAddProject={(name) => run(() => db.addProject(name, ACCENTS[projects.length % 3], projects.length + 1))} />

      <main className="main">
        <header className="head" data-tauri-drag-region>
          {progress ? <Ring fraction={progress.fraction} accent={progress.accent} /> :
            <span className="head-dot" style={{ background: `var(--${project?.color ?? current?.accent ?? "muted"})` }} />}
          <div className="head-text">
            <h2>{project?.name ?? current?.name ?? ""}</h2>
            <p>{progress?.subtitle ?? subtitleFor(view, list.length)}</p>
          </div>
          {project && <DeleteProject name={project.name} onDelete={() => run(() => db.deleteProject(project.id))} />}
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
                onSelect={() => setSel(x.id)} onToggle={() => toggleDone(x)} />
            </div>
          ))}
          {!list.length && <div className="empty">{emptyText(view)}</div>}
        </div>
      </main>

      {task ? (
        <Details key={task.id} task={task} projects={projects}
          onPatch={(p) => patch(task.id, p)}
          onTriage={() => triage(task)} onToggleDone={() => toggleDone(task)}
          onArchive={() => archive(task)} onRestore={() => restore(task)}
          onDelete={() => run(() => db.deleteTask(task.id))} />
      ) : (
        <aside className="det"><div className="hint">Выбери задачу, чтобы увидеть детали.</div></aside>
      )}

      {newOpen && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setNewOpen(false)}>
          <QuickForm onSave={saveNew} onCancel={() => setNewOpen(false)} />
        </div>
      )}
      {helpOpen && <Help onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function subtitleFor(view: ViewId, n: number): string {
  if (view === "archive") return n ? `${n} в архиве` : "";
  if (view === "soon") return n ? "Запланированное на будущее и разобранное без даты" : "";
  return n ? `${n} в работе` : "";
}

function emptyText(view: ViewId): string {
  if (view === "inbox") return "Здесь пусто. Нажми ⌥Space в любом приложении, чтобы записать задачу.";
  if (view === "today") return "На сегодня ничего. Поставь дату «Сегодня» при разборе.";
  if (view === "archive") return "Сделанные задачи попадают сюда на следующий день.";
  return "Здесь пока ничего нет.";
}

function Sidebar(props: {
  view: ViewId;
  tasks: Task[];
  projects: Project[];
  onOpen: (v: ViewId) => void;
  onAddProject: (name: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const item = (id: ViewId, label: string, accent: string) => {
    const n = countFor(id, props.tasks);
    return (
      <button key={id} className={`nav ${props.view === id ? "on" : ""}`} onClick={() => props.onOpen(id)}>
        <i className="dot" style={{ background: `var(--${accent})` }} />
        <span className="nav-name">{label}</span>
        <span className="n">{n || ""}</span>
      </button>
    );
  };
  const finish = () => {
    if (name.trim()) props.onAddProject(name.trim());
    setName("");
    setAdding(false);
  };
  return (
    <nav className="side">
      {VIEWS.map((v) => item(v.id, v.name, v.accent))}
      <div className="sec">Проекты</div>
      {props.projects.map((p) => item(`p:${p.id}`, p.name, p.color))}
      {adding ? (
        <input className="field new-project" autoFocus placeholder="Название проекта" value={name}
          onChange={(e) => setName(e.target.value)} onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter") finish();
            if (e.key === "Escape") (setName(""), setAdding(false));
          }} />
      ) : (
        <button className="nav add-project" onClick={() => setAdding(true)}>+ Новый проект</button>
      )}
    </nav>
  );
}

function TaskRow(props: { task: Task; project?: Project; selected: boolean; onSelect: () => void; onToggle: () => void }) {
  const { task: x, project } = props;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [props.selected]);
  const done = x.status === "done" || x.status === "archived";
  const overdue = x.status === "active" && !!x.due_date && x.due_date < today();
  return (
    <div ref={ref} role="option" aria-selected={props.selected} className={`row ${props.selected ? "sel" : ""} ${done ? "done" : ""}`}
      onMouseDown={props.onSelect}>
      <button className="chk" title={done ? "Вернуть" : "Сделано"} disabled={x.status === "archived"}
        onClick={(e) => (e.stopPropagation(), props.onToggle())} />
      <span className="t">{x.title}</span>
      {x.remind_at && !x.reminded && !done && <span className="meta" title="Напоминание">⏰ {x.remind_at.slice(11, 16)}</span>}
      {x.priority === 3 && !done && <span className="tag" style={{ background: "var(--move)" }}>!</span>}
      {project && <span className="tag" style={{ background: `var(--${project.color})` }}>{project.name}</span>}
      {x.due_date && <span className={`meta ${overdue ? "overdue" : ""}`}>{fmtDay(x.due_date)}</span>}
    </div>
  );
}

function DeleteProject({ name, onDelete }: { name: string; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button className={`link danger ${armed ? "armed" : ""}`} onBlur={() => setArmed(false)}
      onClick={() => (armed ? onDelete() : setArmed(true))}
      title="Задачи проекта останутся, просто без проекта">
      {armed ? `Удалить «${name}»?` : "Удалить проект"}
    </button>
  );
}
