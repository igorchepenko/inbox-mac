import type { Task } from "./db";
import { fmtDay, today } from "./dates";
import { quickKeyLabel } from "./prefs";

export type ViewId = "home" | "inbox" | "today" | "soon" | "archive" | "calendar" | `p:${number}`;

export const VIEWS: { id: ViewId; name: string; accent: string; icon: string }[] = [
  { id: "inbox", name: "На разбор", accent: "move", icon: "inbox" },
  { id: "today", name: "Сегодня", accent: "exercise", icon: "sun" },
  { id: "soon", name: "Скоро", accent: "stand", icon: "calendar" },
  { id: "archive", name: "Архив", accent: "muted", icon: "archive" },
  { id: "calendar", name: "Календарь", accent: "stand", icon: "schedule" },
];

export interface ListItem {
  task: Task;
  group?: string; // заголовок группы перед строкой
}

const doneToday = (x: Task, t: string) => x.status === "done" && !!x.done_at && x.done_at.slice(0, 10) === t;

// Открытые выше сделанных, затем по дате (без даты в конце), важности и свежести
function byWork(a: Task, b: Task): number {
  const da = a.status === "done" ? 1 : 0, dbn = b.status === "done" ? 1 : 0;
  if (da !== dbn) return da - dbn;
  const ad = a.due_date ?? "9999", bd = b.due_date ?? "9999";
  if (ad !== bd) return ad < bd ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.created_at < b.created_at ? 1 : -1;
}

export function listFor(view: ViewId, tasks: Task[]): ListItem[] {
  const t = today();
  if (view === "home") return [];
  if (view === "inbox") return tasks.filter((x) => x.status === "inbox").map((task) => ({ task }));
  if (view === "today")
    return tasks
      .filter((x) => (x.status === "active" && !!x.due_date && x.due_date <= t) || doneToday(x, t))
      .sort(byWork)
      .map((task) => ({ task }));
  if (view === "archive")
    return tasks
      .filter((x) => x.status === "archived")
      .sort((a, b) => ((a.done_at ?? "") < (b.done_at ?? "") ? 1 : -1))
      .map((task) => ({ task }));
  if (view === "soon") {
    // Будущие даты по дням, затем всё разобранное без даты, чтобы ничего не терялось
    const dated = tasks.filter((x) => x.status === "active" && !!x.due_date && x.due_date > t).sort(byWork);
    const undated = tasks.filter((x) => x.status === "active" && !x.due_date).sort(byWork);
    const out: ListItem[] = [];
    let last = "";
    for (const task of dated) {
      const g = fmtDay(task.due_date!);
      out.push(g !== last ? { task, group: g } : { task });
      last = g;
    }
    undated.forEach((task, i) => out.push(i === 0 ? { task, group: "Без даты" } : { task }));
    return out;
  }
  if (view === "calendar") return []; // у календаря своя сетка, см. CalendarView
  const pid = Number(view.slice(2));
  return tasks
    .filter((x) => x.project_id === pid && (x.status === "active" || doneToday(x, t)))
    .sort(byWork)
    .map((task) => ({ task }));
}

export function countFor(view: ViewId, tasks: Task[]): number {
  if (view === "archive" || view === "calendar") return 0;
  return listFor(view, tasks).filter((i) => i.task.status !== "done").length;
}

export interface Progress {
  fraction: number;
  count: number; // сколько осталось: неразобранных или несделанных
  accent: string;
  subtitle: string;
}

export function progressFor(view: ViewId, tasks: Task[]): Progress | null {
  const t = today();
  if (view === "inbox") {
    const left = tasks.filter((x) => x.status === "inbox").length;
    const sorted = tasks.filter((x) => x.triaged_at?.slice(0, 10) === t).length;
    const subtitle = left
      ? `${plural(left, "задача ждёт", "задачи ждут", "задач ждут")} разбора${sorted ? `, разобрано сегодня ${sorted}` : ""}`
      : sorted ? `Всё разобрано, сегодня ${sorted}` : `Пусто. Нажми ${quickKeyLabel()}, чтобы записать задачу`;
    return { fraction: left + sorted ? sorted / (left + sorted) : 0, count: left, accent: "move", subtitle };
  }
  if (view === "today") {
    const items = listFor("today", tasks);
    const done = items.filter((i) => i.task.status === "done").length;
    return {
      fraction: items.length ? done / items.length : 0,
      count: items.length - done,
      accent: "exercise",
      subtitle: items.length ? `${done} из ${items.length} сделано` : "На сегодня ничего не запланировано",
    };
  }
  return null;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
}
