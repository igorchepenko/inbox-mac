import Database from "@tauri-apps/plugin-sql";
import { nowStamp, today } from "./dates";

export type Status = "inbox" | "active" | "done" | "archived";
export type Accent = "move" | "exercise" | "stand";

export interface Task {
  id: number;
  title: string;
  note: string;
  status: Status;
  priority: number; // 0 не задана, 1 низкая, 2 средняя, 3 высокая
  project_id: number | null;
  due_date: string | null;
  remind_at: string | null;
  reminded: number;
  created_at: string;
  triaged_at: string | null;
  done_at: string | null;
}

export interface Project {
  id: number;
  name: string;
  color: Accent;
  position: number;
}

let dbPromise: Promise<Database> | null = null;
function db(): Promise<Database> {
  // Миграции в src-tauri/migrations применяются при первой загрузке
  return (dbPromise ??= Database.load("sqlite:inbox.db"));
}

export async function loadTasks(): Promise<Task[]> {
  return (await db()).select<Task[]>("SELECT * FROM tasks ORDER BY created_at DESC");
}

export async function loadProjects(): Promise<Project[]> {
  return (await db()).select<Project[]>("SELECT * FROM projects ORDER BY position, id");
}

export async function addTask(title: string, note: string): Promise<number> {
  const r = await (await db()).execute(
    "INSERT INTO tasks (title, note, status, created_at) VALUES ($1, $2, 'inbox', $3)",
    [title, note, nowStamp()],
  );
  return r.lastInsertId ?? 0;
}

type Editable = Pick<Task, "title" | "note" | "priority" | "project_id" | "due_date" | "remind_at" | "status" | "reminded" | "triaged_at" | "done_at">;

export async function updateTask(id: number, patch: Partial<Editable>): Promise<void> {
  const keys = Object.keys(patch) as (keyof Editable)[];
  if (!keys.length) return;
  const set = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  await (await db()).execute(`UPDATE tasks SET ${set} WHERE id = $${keys.length + 1}`, [
    ...keys.map((k) => patch[k]),
    id,
  ]);
}

export async function deleteTask(id: number): Promise<void> {
  await (await db()).execute("DELETE FROM tasks WHERE id = $1", [id]);
}

export async function addProject(name: string, color: Accent, position: number): Promise<void> {
  await (await db()).execute("INSERT INTO projects (name, color, position) VALUES ($1, $2, $3)", [name, color, position]);
}

export async function deleteProject(id: number): Promise<void> {
  const d = await db();
  await d.execute("UPDATE tasks SET project_id = NULL WHERE project_id = $1", [id]);
  await d.execute("DELETE FROM projects WHERE id = $1", [id]);
}

/** Сделанные до сегодняшнего дня задачи сами уходят в архив: сегодняшние ещё видны и считаются в кольце */
export async function archiveOldDone(): Promise<void> {
  await (await db()).execute("UPDATE tasks SET status = 'archived' WHERE status = 'done' AND done_at < $1", [today()]);
}
