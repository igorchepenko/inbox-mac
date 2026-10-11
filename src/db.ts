import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { nowStamp, stampDay, today } from "./dates";
import { nextOccurrence, parseRule } from "./recurrence";
import { activeProfile } from "./profile";
import { normalizeTag, pickColor, sameName, TAG_MAX, byName } from "./tags";
import { remindPatch } from "./remind";

export type Status = "inbox" | "active" | "done" | "archived";
/** Тип задачи: обычная или встреча (звонок с клиентом, с командой) */
export type TaskKind = "task" | "meeting";
/** Цвета проектов. Системные move, exercise и stand проектам не достаются */
// id цвета из палитры проектов, см. src/palette.ts
export type ProjectColor = string;

export interface Task {
  id: number;
  title: string;
  note: string;
  status: Status;
  priority: number; // 0 не задана, 1 минимальная, 2 низкая, 3 средняя, 4 высокая, 5 максимальная (миграция 005)
  project_id: number | null;
  due_date: string | null;
  remind_at: string | null;
  reminded: number;
  created_at: string;
  triaged_at: string | null;
  done_at: string | null;
  start_time: string | null; // HH:MM, начало в день due_date
  end_time: string | null; // HH:MM, конец в тот же день; без start_time не бывает
  quadrant: number | null; // матрица Эйзенхауэра: 1 срочно и важно, 2 важно, 3 срочно, 4 ни то ни другое
  recurrence: string | null; // правило повтора, JSON из recurrence.ts
  series_id: number | null; // первая задача серии повторов
  next_id: number | null; // у сделанной повторяющейся: созданный следующий повтор
  started_at: string | null; // когда взяли в работу: этап «В работе» на канбане
  assigned_by: string | null; // кто поставил задачу, имя как ввели (миграция 008)
  remind_before: number | null; // напоминание за столько минут до задачи (миграция 010), NULL — своё время, см. remind.ts
  kind: TaskKind;
  // Не колонки tasks: подтягиваются из своих таблиц в loadTasks
  subtasks: Subtask[];
  links: Link[];
  files: Attachment[];
  tags: Tag[]; // в порядке, в каком добавлены
}

export interface Tag {
  id: number;
  name: string;
  color: string; // id цвета из TAG_COLORS (src/tags.ts), в CSS var(--<id>)
}

export interface Subtask {
  id: number;
  task_id: number;
  title: string;
  done: number;
  position: number;
}

export interface Link {
  id: number;
  task_id: number;
  url: string;
  title: string;
  position: number;
}

export interface Attachment {
  id: number;
  task_id: number;
  name: string;
  path: string;
  size: number;
  added_at: string;
}

export interface Project {
  id: number;
  name: string;
  color: ProjectColor;
  icon: string;
  description: string;
  position: number;
}

export type ProjectFields = Pick<Project, "name" | "description" | "color" | "icon">;

let dbPromise: Promise<Database> | null = null;
function db(): Promise<Database> {
  // База активного профиля. Rust перед этим делает копию базы, если вышла новая версия,
  // а миграции из src-tauri/migrations применяются при первой загрузке
  return (dbPromise ??= invoke<string>("use_profile", { id: activeProfile() }).then((url) => Database.load(url)));
}

export async function loadTasks(): Promise<Task[]> {
  const d = await db();
  const [tasks, subs, links, files, tags] = await Promise.all([
    d.select<Task[]>("SELECT * FROM tasks ORDER BY created_at DESC"),
    d.select<Subtask[]>("SELECT * FROM subtasks ORDER BY position, id"),
    d.select<Link[]>("SELECT * FROM links ORDER BY position, id"),
    d.select<Attachment[]>("SELECT * FROM attachments ORDER BY id"),
    d.select<(Tag & { task_id: number })[]>(
      "SELECT tt.task_id, t.id, t.name, t.color FROM task_tags tt JOIN tags t ON t.id = tt.tag_id ORDER BY tt.position, t.id",
    ),
  ]);
  const byTask = <T extends { task_id: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) m.set(r.task_id, [...(m.get(r.task_id) ?? []), r]);
    return m;
  };
  const s = byTask(subs), l = byTask(links), f = byTask(files), g = byTask(tags);
  return tasks.map((t) => ({
    ...t, subtasks: s.get(t.id) ?? [], links: l.get(t.id) ?? [], files: f.get(t.id) ?? [],
    tags: (g.get(t.id) ?? []).map(({ id, name, color }) => ({ id, name, color })),
  }));
}

export async function loadProjects(): Promise<Project[]> {
  return (await db()).select<Project[]>("SELECT * FROM projects ORDER BY position, id");
}

/** Необязательные поля, которые можно задать сразу при записи задачи. tags — названия, новые теги создаются сами */
export type Draft = Partial<Pick<Task, "priority" | "project_id" | "due_date" | "remind_at" | "start_time" | "end_time" | "quadrant" | "recurrence" | "assigned_by" | "remind_before" | "kind">> & {
  tags?: string[];
};

const DRAFT_KEYS = ["priority", "project_id", "due_date", "remind_at", "start_time", "end_time", "quadrant", "recurrence", "assigned_by", "remind_before", "kind"] as const;

/** Новая задача всегда попадает в «На разбор», даже если поля заполнены сразу */
export async function addTask(title: string, note: string, draft: Draft = {}): Promise<number> {
  const keys = DRAFT_KEYS.filter((k) => draft[k] != null);
  const cols = ["title", "note", "status", "created_at", ...keys];
  const vals = [title, note, "inbox", nowStamp(), ...keys.map((k) => draft[k])];
  const r = await (await db()).execute(
    `INSERT INTO tasks (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    vals,
  );
  const id = r.lastInsertId ?? 0;
  if (id && draft.tags?.length) await setTaskTags(id, draft.tags);
  return id;
}

type Editable = Pick<Task, "title" | "note" | "priority" | "project_id" | "due_date" | "remind_at" | "status" | "reminded" | "triaged_at" | "done_at" | "start_time" | "end_time" | "quadrant" | "recurrence" | "series_id" | "next_id" | "started_at" | "assigned_by" | "remind_before" | "kind">;

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
  const d = await db();
  const files = await d.select<Attachment[]>("SELECT * FROM attachments WHERE task_id = $1", [id]);
  for (const t of ["subtasks", "links", "attachments", "task_tags"]) await d.execute(`DELETE FROM ${t} WHERE task_id = $1`, [id]);
  await d.execute("DELETE FROM tasks WHERE id = $1", [id]);
  for (const f of files) await dropFileIfUnused(f.path);
}

/**
 * Отметить сделанной. У повторяющейся рядом создаётся следующий повтор: та же задача с новой датой,
 * чеклист снова не отмечен, ссылки и файлы те же. Сделанная остаётся в истории и уходит в архив как обычно.
 */
export async function completeTask(x: Task): Promise<void> {
  const stamp = nowStamp();
  const rule = parseRule(x.recurrence);
  const next = rule && nextOccurrence(rule, x.due_date, stampDay(stamp));
  let nextId: number | null = null;
  if (next) {
    const d = await db();
    const remind = remindPatch(x, { due_date: next.date }).remind_at ?? null;
    const r = await d.execute(
      `INSERT INTO tasks (title, note, status, priority, project_id, due_date, remind_at, created_at, triaged_at,
         start_time, end_time, quadrant, recurrence, series_id, assigned_by, remind_before, kind)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [x.title, x.note, x.priority, x.project_id, next.date, remind, stamp, x.start_time, x.end_time, x.quadrant,
        JSON.stringify(next.rule), x.series_id ?? x.id, x.assigned_by, x.remind_before, x.kind],
    );
    nextId = r.lastInsertId ?? null;
    if (nextId) {
      for (const s of x.subtasks)
        await d.execute("INSERT INTO subtasks (task_id, title, done, position) VALUES ($1, $2, 0, $3)", [nextId, s.title, s.position]);
      for (const l of x.links)
        await d.execute("INSERT INTO links (task_id, url, title, position) VALUES ($1, $2, $3, $4)", [nextId, l.url, l.title, l.position]);
      // Копия файла не нужна: обе задачи ссылаются на один файл, он удаляется, когда не нужен никому
      for (const f of x.files)
        await d.execute("INSERT INTO attachments (task_id, name, path, size, added_at) VALUES ($1, $2, $3, $4, $5)", [nextId, f.name, f.path, f.size, f.added_at]);
      for (const [i, g] of x.tags.entries())
        await d.execute("INSERT INTO task_tags (task_id, tag_id, position) VALUES ($1, $2, $3)", [nextId, g.id, i]);
    }
  }
  await updateTask(x.id, { status: "done", done_at: stamp, next_id: nextId });
}

/** Вернуть сделанную в работу. Если она успела создать следующий повтор и тот ещё не сделан, он убирается */
export async function reopenTask(x: Task): Promise<void> {
  if (x.next_id) {
    const [n] = await (await db()).select<Task[]>("SELECT * FROM tasks WHERE id = $1", [x.next_id]);
    if (n && (n.status === "active" || n.status === "inbox")) await deleteTask(n.id);
  }
  await updateTask(x.id, { status: "active", done_at: null, next_id: null });
}

// Теги. Создаются сами, когда их впервые ставят задаче; цвет подбирается подальше от уже занятых

export async function loadTags(): Promise<Tag[]> {
  const rows = await (await db()).select<Tag[]>("SELECT id, name, color FROM tags");
  return rows.sort((a, b) => byName(a.name, b.name));
}

/** Все, кто когда-либо назначал задачи: подсказки в поле «Кто назначил» */
export async function loadPeople(): Promise<string[]> {
  const rows = await (await db()).select<{ name: string }[]>(
    "SELECT DISTINCT assigned_by AS name FROM tasks WHERE assigned_by IS NOT NULL AND assigned_by <> ''",
  );
  const out: string[] = [];
  for (const { name } of rows) if (!out.some((p) => sameName(p, name))) out.push(name);
  return out.sort(byName);
}

/** Все, кто назначал задачи, и сколько задач у каждого: раздел «Кто назначил» в настройках.
 * Одно имя в разном регистре считается одним человеком, показываем самое частое написание */
export async function loadPeopleStats(): Promise<{ name: string; count: number }[]> {
  const rows = await (await db()).select<{ name: string; n: number }[]>(
    "SELECT assigned_by AS name, COUNT(*) AS n FROM tasks WHERE assigned_by IS NOT NULL AND assigned_by <> '' GROUP BY assigned_by ORDER BY n DESC",
  );
  const out: { name: string; count: number }[] = [];
  for (const r of rows) {
    const same = out.find((p) => sameName(p.name, r.name));
    if (same) same.count += r.n;
    else out.push({ name: r.name, count: r.n });
  }
  return out.sort((a, b) => byName(a.name, b.name));
}

/**
 * Переименовать человека во всех задачах. Если новое имя уже есть у другого, это объединение: задачи переходят к нему
 * в его написании. to = null убирает человека, задачи становятся «Сам себе»
 */
export async function renamePerson(from: string, to: string | null): Promise<void> {
  const d = await db();
  const names = (await d.select<{ name: string }[]>("SELECT DISTINCT assigned_by AS name FROM tasks WHERE assigned_by IS NOT NULL"))
    .map((r) => r.name);
  const clean = to?.replace(/\s+/g, " ").trim() || null;
  // Написание того, к кому объединяем: берём уже существующее, если это другой человек
  const target = clean && !sameName(clean, from) ? names.find((n) => sameName(n, clean)) ?? clean : clean;
  for (const n of names.filter((n) => sameName(n, from))) await d.execute("UPDATE tasks SET assigned_by = $1 WHERE assigned_by = $2", [target, n]);
}

/** Заменить теги задачи. Названия сверяются без учёта регистра, лишние сверх шести отбрасываются */
export async function setTaskTags(taskId: number, names: string[]): Promise<void> {
  const d = await db();
  const all = await loadTags();
  const ids: number[] = [];
  for (const raw of names) {
    const name = normalizeTag(raw);
    if (!name || ids.length >= TAG_MAX) continue;
    let tag = all.find((t) => sameName(t.name, name));
    if (!tag) {
      const color = pickColor(all.map((t) => t.color));
      const r = await d.execute("INSERT INTO tags (name, color, created_at) VALUES ($1, $2, $3)", [name, color, nowStamp()]);
      tag = { id: r.lastInsertId ?? 0, name, color };
      all.push(tag);
    }
    if (!ids.includes(tag.id)) ids.push(tag.id);
  }
  await d.execute("DELETE FROM task_tags WHERE task_id = $1", [taskId]);
  for (const [i, id] of ids.entries()) await d.execute("INSERT INTO task_tags (task_id, tag_id, position) VALUES ($1, $2, $3)", [taskId, id, i]);
}

export type TagPatch = Partial<Pick<Tag, "name" | "color">>;

/** Переименовать или перекрасить. Имя, которое уже занято другим тегом, не принимается */
export async function updateTag(id: number, patch: TagPatch): Promise<void> {
  const d = await db();
  if (patch.name != null) {
    const name = normalizeTag(patch.name);
    if (!name) throw new Error("Пустое название тега");
    if ((await loadTags()).some((t) => t.id !== id && sameName(t.name, name))) throw new Error(`Тег «${name}» уже есть`);
    await d.execute("UPDATE tags SET name = $1 WHERE id = $2", [name, id]);
  }
  if (patch.color) await d.execute("UPDATE tags SET color = $1 WHERE id = $2", [patch.color, id]);
}

/** Удалить тег: снимается со всех задач, сами задачи остаются */
export async function deleteTag(id: number): Promise<void> {
  const d = await db();
  await d.execute("DELETE FROM task_tags WHERE tag_id = $1", [id]);
  await d.execute("DELETE FROM tags WHERE id = $1", [id]);
}

// Подзадачи-чеклист

export async function addSubtask(taskId: number, title: string, position: number): Promise<void> {
  await (await db()).execute("INSERT INTO subtasks (task_id, title, position) VALUES ($1, $2, $3)", [taskId, title, position]);
}

export async function updateSubtask(id: number, patch: Partial<Pick<Subtask, "title" | "done">>): Promise<void> {
  const keys = Object.keys(patch) as ("title" | "done")[];
  if (!keys.length) return;
  await (await db()).execute(`UPDATE subtasks SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")} WHERE id = $${keys.length + 1}`, [
    ...keys.map((k) => patch[k]),
    id,
  ]);
}

export async function deleteSubtask(id: number): Promise<void> {
  await (await db()).execute("DELETE FROM subtasks WHERE id = $1", [id]);
}

/** Новый порядок пунктов после перетаскивания */
export async function reorderSubtasks(ids: number[]): Promise<void> {
  const d = await db();
  for (const [i, id] of ids.entries()) await d.execute("UPDATE subtasks SET position = $1 WHERE id = $2", [i + 1, id]);
}

// Ссылки

export async function addLink(taskId: number, url: string, title: string, position: number): Promise<void> {
  await (await db()).execute("INSERT INTO links (task_id, url, title, position) VALUES ($1, $2, $3, $4)", [taskId, url, title, position]);
}

export async function renameLink(id: number, title: string): Promise<void> {
  await (await db()).execute("UPDATE links SET title = $1 WHERE id = $2", [title, id]);
}

export async function deleteLink(id: number): Promise<void> {
  await (await db()).execute("DELETE FROM links WHERE id = $1", [id]);
}

export const openUrl = (url: string) => invoke("open_url", { url });

// Файлы. Копия кладётся в папку приложения, поэтому переименование или удаление оригинала задачу не ломает

interface Stored {
  name: string;
  path: string;
  size: number;
}

export async function attachFiles(taskId: number, paths: string[]): Promise<void> {
  const d = await db();
  for (const src of paths) {
    const f = await invoke<Stored>("attach_file", { taskId, src });
    await d.execute("INSERT INTO attachments (task_id, name, path, size, added_at) VALUES ($1, $2, $3, $4, $5)", [
      taskId, f.name, f.path, f.size, nowStamp(),
    ]);
  }
}

export async function deleteAttachment(a: Attachment): Promise<void> {
  await (await db()).execute("DELETE FROM attachments WHERE id = $1", [a.id]);
  await dropFileIfUnused(a.path);
}

async function dropFileIfUnused(path: string): Promise<void> {
  const [{ n }] = await (await db()).select<{ n: number }[]>("SELECT COUNT(*) AS n FROM attachments WHERE path = $1", [path]);
  if (!n) await invoke("remove_attachment", { path }).catch(() => {});
}

export const openFile = (path: string) => invoke("open_path", { path });
export const revealFile = (path: string) => invoke("reveal_path", { path });

export async function addProject(p: ProjectFields, position: number): Promise<number> {
  const r = await (await db()).execute(
    "INSERT INTO projects (name, description, color, icon, position) VALUES ($1, $2, $3, $4, $5)",
    [p.name, p.description, p.color, p.icon, position],
  );
  return Number(r.lastInsertId);
}

export async function updateProject(id: number, p: ProjectFields): Promise<void> {
  await (await db()).execute(
    "UPDATE projects SET name = $1, description = $2, color = $3, icon = $4 WHERE id = $5",
    [p.name, p.description, p.color, p.icon, id],
  );
}

export async function loadSettings(): Promise<Record<string, string>> {
  const rows = await (await db()).select<{ key: string; value: string }[]>("SELECT key, value FROM settings");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSetting(key: string, value: string): Promise<void> {
  await (await db()).execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

/** Что делать с задачами удаляемого пространства: перенести в другое, оставить без пространства или удалить */
export type ProjectTasksFate = { move: number } | "keep" | "delete";

export async function deleteProject(id: number, fate: ProjectTasksFate = "keep"): Promise<void> {
  const d = await db();
  if (fate === "delete") {
    const ids = await d.select<{ id: number }[]>("SELECT id FROM tasks WHERE project_id = $1", [id]);
    for (const x of ids) await deleteTask(x.id);
  } else {
    await d.execute("UPDATE tasks SET project_id = $1 WHERE project_id = $2", [fate === "keep" ? null : fate.move, id]);
  }
  await d.execute("DELETE FROM projects WHERE id = $1", [id]);
}

/** Сделанные до сегодняшнего дня задачи сами уходят в архив: сегодняшние ещё видны и считаются в кольце */
export async function archiveOldDone(): Promise<void> {
  await (await db()).execute("UPDATE tasks SET status = 'archived' WHERE status = 'done' AND done_at < $1", [today()]);
}
