import type { CSSProperties } from "react";
import { Pencil, Plus } from "lucide-react";
import type { Project, Task } from "./db";
import { fmtDay, today } from "./dates";
import { Icon } from "./icons";
import { plural, type ViewId } from "./views";

interface Card {
  project: Project;
  open: number;
  overdue: number;
  dueToday: number;
  inbox: number;
  done: number;
  next?: Task;
}

const isDone = (x: Task) => x.status === "done" || x.status === "archived";

function cardsFor(projects: Project[], tasks: Task[]): Card[] {
  const t = today();
  return projects.map((project) => {
    const own = tasks.filter((x) => x.project_id === project.id);
    const active = own.filter((x) => x.status === "active");
    // Ближайшая по дате открытая задача: то, о чём проект напомнит первым
    const next = active.filter((x) => x.due_date).sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : b.priority - a.priority))[0];
    return {
      project,
      open: active.length,
      overdue: active.filter((x) => !!x.due_date && x.due_date < t).length,
      dueToday: active.filter((x) => x.due_date === t).length,
      inbox: own.filter((x) => x.status === "inbox").length,
      done: own.filter(isDone).length,
      next,
    };
  });
}

/** Все проекты карточками: название, описание, сводка по задачам и прогресс */
export default function ProjectsPage(props: {
  projects: Project[];
  tasks: Task[];
  onOpen: (v: ViewId) => void;
  onEdit: (p: Project) => void;
  onNew: () => void;
}) {
  const cards = cardsFor(props.projects, props.tasks);
  const open = cards.reduce((n, c) => n + c.open, 0);
  const overdue = cards.reduce((n, c) => n + c.overdue, 0);
  return (
    <div className="pp">
      <header className="pp-head" data-tauri-drag-region>
        <div>
          <h2>Пространства</h2>
          <p>
            {cards.length ? plural(cards.length, "пространство", "пространства", "пространств") : "Пока ни одного пространства"}
            {open > 0 && <> · {plural(open, "открытая задача", "открытые задачи", "открытых задач")}</>}
            {overdue > 0 && <> · <span className="pp-bad">{overdue} просрочено</span></>}
          </p>
        </div>
        <button className="cta stand narrow" onClick={props.onNew}><Plus size={14} /> Новое пространство</button>
      </header>
      <div className="pp-grid">
        {cards.map((c) => {
          const p = c.project;
          const total = c.open + c.done;
          return (
            <div key={p.id} className="pp-card" role="button" tabIndex={0} style={{ "--c": `var(--${p.color})` } as CSSProperties}
              onClick={() => props.onOpen(`p:${p.id}`)} onKeyDown={(e) => e.key === "Enter" && props.onOpen(`p:${p.id}`)}>
              <div className="pp-top">
                <span className="pp-icon"><Icon name={p.icon} size={18} /></span>
                <b className="pp-name" title={p.name}>{p.name}</b>
                <button className="pp-edit" data-tip="Изменить пространство" aria-label="Изменить пространство"
                  onClick={(e) => (e.stopPropagation(), props.onEdit(p))}><Pencil size={13} /></button>
              </div>
              <p className={`pp-desc ${p.description ? "" : "none"}`} title={p.description || undefined}>
                {p.description || "Без описания"}
              </p>
              <div className="pp-stats">
                <span><b>{c.open}</b> открыто</span>
                {c.dueToday > 0 && <span><b>{c.dueToday}</b> на сегодня</span>}
                {c.overdue > 0 && <span className="pp-bad"><b>{c.overdue}</b> просрочено</span>}
                {c.inbox > 0 && <span><b>{c.inbox}</b> на разборе</span>}
              </div>
              <div className="pp-next">
                {c.next ? <><span className="pp-next-t">{c.next.title}</span><span className="meta">{fmtDay(c.next.due_date!)}</span></>
                  : <span className="pp-next-t muted">{c.open ? "Без сроков" : "Открытых задач нет"}</span>}
              </div>
              <div className="pp-foot">
                <span className="pb"><i style={{ width: `${total ? (c.done / total) * 100 : 0}%` }} /></span>
                <span className="meta">{c.done}/{total}</span>
              </div>
            </div>
          );
        })}
        <button className="pp-card pp-new" onClick={props.onNew}><Plus size={18} /> Новое пространство</button>
      </div>
    </div>
  );
}
