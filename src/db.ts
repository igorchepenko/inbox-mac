import { relationsByTask, rowFor, wouldCycle, type Relation, type RelationKind, type RelationRow } from "./relations";
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
  end_time: string | null; // HH:MM, конец в тот же день; без start_time это срок задачи «до 18:00», см. due.ts
  quadrant: number | null; // матрица Эйзенхауэра: 1 срочно и важно, 2 важно, 3 срочно, 4 ни то ни другое
  recurrence: string | null; // правило повтора, JSON из recurrence.ts
  series_id: number | null; // первая задача серии повторов
  next_id: number | null; // у сделанной повторяющейся: созданный следующий повтор
  started_at: string | null; // когда взяли в работу: этап «В работе» на канбане
  assigned_by: string | null; // кто поставил задачу, имя как ввели (миграция 008)
  remind_before: number | null; // напоминание за столько минут до задачи (миграция 010), NULL — своё время, см. remind.ts
  kind: TaskKind;
  cancelled: number; // 1 — закрыта отменой, а не сделана (миграция 012). Статус при этом done или archived
  summary: string; // итоги: почему отменил или что получилось, в свободной форме (миграция 012)
  waiting_for: string | null; // статус «Жду»: от кого ждём ответа или результата, NULL — никого (миграция 013)
  waiting_until: string | null; // день, когда пора напомнить; в этот день задача возвращается в «Сегодня»
  // Не колонки tasks: подтягиваются из своих таблиц в loadTasks
  subtasks: Subtask[];
  links: Link[];
  files: Attachment[];
  tags: Tag[]; // в порядке, в каком добавлены
  participants: string[]; // участники встречи, из списка «Кто назначил» (миграция 011)
  relations: Relation[]; // связи с другими задачами с её стороны (миграция 015), см. relations.ts
}

/** Закрыта: сделана или отменена, в том числе уже в архиве */
export const isClosed = (x: Pick<Task, "status">) => x.status === "done" || x.status === "archived";
/** Закрыта отменой */
export const isCancelled = (x: Pick<Task, "status" | "cancelled">) => isClosed(x) && !!x.cancelled;
/** Сделана по-настоящему: для счётчиков «сделано», отменённые туда не идут */
export const isDoneReal = (x: Pick<Task, "status" | "cancelled">) => isClosed(x) && !x.cancelled;

export interface Tag {
  id: number;
  name: string;
  color: string; // id цвета из TAG_COLORS (src/tags.ts), в CSS var(--<id>)
}

/** Человек из раздела «Люди» (миграция 014). Задачи привязаны к нему по имени */
export interface Person {
  id: number;
  name: string;
  phone: string;
  telegram: string; // ник без @
  comment: string;
  birthday: string | null; // «ММ-ДД» или «ГГГГ-ММ-ДД», см. people.ts
  company: string;
  job_title: string;
  tags: Tag[]; // те же теги, что у задач
}

export type PersonFields = Omit<Person, "id" | "tags"> & { tags: string[] };

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
  const [tasks, subs, links, files, tags, people, rels] = await Promise.all([
    d.select<Task[]>("SELECT * FROM tasks ORDER BY created_at DESC"),
    d.select<Subtask[]>("SELECT * FROM subtasks ORDER BY position, id"),
    d.select<Link[]>("SELECT * FROM links ORDER BY position, id"),
    d.select<Attachment[]>("SELECT * FROM attachments ORDER BY id"),
    d.select<(Tag & { task_id: number })[]>(
      "SELECT tt.task_id, t.id, t.name, t.color FROM task_tags tt JOIN tags t ON t.id = tt.tag_id ORDER BY tt.position, t.id",
    ),
    d.select<{ task_id: number; name: string }[]>("SELECT task_id, name FROM task_people ORDER BY position"),
    d.select<RelationRow[]>("SELECT id, from_id, to_id, kind FROM task_relations ORDER BY id"),
  ]);
  const byTask = <T extends { task_id: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) m.set(r.task_id, [...(m.get(r.task_id) ?? []), r]);
    return m;
  };
  const s = byTask(subs), l = byTask(links), f = byTask(files), g = byTask(tags), p = byTask(people);
  const r = relationsByTask(rels, tasks);
  return tasks.map((t) => ({
    ...t, subtasks: s.get(t.id) ?? [], links: l.get(t.id) ?? [], files: f.get(t.id) ?? [],
    tags: (g.get(t.id) ?? []).map(({ id, name, color }) => ({ id, name, color })),
    participants: (p.get(t.id) ?? []).map((r) => r.name),
    relations: r.get(t.id) ?? [],
  }));
}

export async function loadProjects(): Promise<Project[]> {
  return (await db()).select<Project[]>("SELECT * FROM projects ORDER BY position, id");
}

/** Необязательные поля, которые можно задать сразу при записи задачи. tags — названия, новые теги создаются сами.
 * participants — участники встречи, link — ссылка на встречу (уже проверенный адрес) */
export type Draft = Partial<Pick<Task, "priority" | "project_id" | "due_date" | "remind_at" | "start_time" | "end_time" | "quadrant" | "recurrence" | "assigned_by" | "remind_before" | "kind">> & {
  /** Этап при записи: new — в «Новые» (по умолчанию), todo — сразу разобрана, done — сразу сделана */
  stage?: "new" | "todo" | "done";
  tags?: string[];
  participants?: string[];
  link?: string;
};

const DRAFT_KEYS = ["priority", "project_id", "due_date", "remind_at", "start_time", "end_time", "quadrant", "recurrence", "assigned_by", "remind_before", "kind"] as const;

/** Новая задача попадает в «Новые», если при записи не выбрали другой этап */
export async function addTask(title: string, note: string, draft: Draft = {}): Promise<number> {
  const keys = DRAFT_KEYS.filter((k) => draft[k] != null);
  const stamp = nowStamp();
  const triaged = draft.stage === "todo" || draft.stage === "done";
  const cols = ["title", "note", "status", "created_at", "triaged_at", ...keys];
  const vals = [title, note, triaged ? "active" : "inbox", stamp, triaged ? stamp : null, ...keys.map((k) => draft[k])];
  const r = await (await db()).execute(
    `INSERT INTO tasks (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    vals,
  );
  const id = r.lastInsertId ?? 0;
  if (id && draft.tags?.length) await setTaskTags(id, draft.tags);
  if (id && draft.participants?.length) await setTaskPeople(id, draft.participants);
  if (id && draft.link) await addLink(id, draft.link, "", 1);
  // Сразу сделанная: через completeTask, чтобы у повторяющейся появился следующий повтор
  if (id && draft.stage === "done") {
    const x = (await loadTasks()).find((t) => t.id === id);
    if (x) await completeTask(x);
  }
  return id;
}

type Editable = Pick<Task, "title" | "note" | "priority" | "project_id" | "due_date" | "remind_at" | "status" | "reminded" | "triaged_at" | "done_at" | "start_time" | "end_time" | "quadrant" | "recurrence" | "series_id" | "next_id" | "started_at" | "assigned_by" | "remind_before" | "kind" | "cancelled" | "summary" | "waiting_for" | "waiting_until">;

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
  for (const t of ["subtasks", "links", "attachments", "task_tags", "task_people"]) await d.execute(`DELETE FROM ${t} WHERE task_id = $1`, [id]);
  await d.execute("DELETE FROM task_relations WHERE from_id = $1 OR to_id = $1", [id]);
  await d.execute("DELETE FROM tasks WHERE id = $1", [id]);
  for (const f of files) await dropFileIfUnused(f.path);
}

/**
 * Отметить сделанной. У повторяющейся рядом создаётся следующий повтор: та же задача с новой датой,
 * чеклист снова не отмечен, ссылки и файлы те же. Сделанная остаётся в истории и уходит в архив как обычно.
 * Отменённую просто переводим в сделанные: повтор она уже создала при отмене
 */
export async function completeTask(x: Task): Promise<void> {
  if (isCancelled(x)) return updateTask(x.id, { status: "done", done_at: nowStamp(), cancelled: 0 });
  await close(x);
}

/**
 * Отменить. Можно из любого этапа, кроме сделанной: сделанную сначала возвращают в работу.
 * Закрывается так же, как сделанная: у повторяющейся появляется следующий повтор, серия продолжается
 */
export async function cancelTask(x: Task): Promise<void> {
  if (isClosed(x)) {
    if (x.cancelled) return;
    throw new Error("Сделанную задачу нельзя отменить. Сначала верни её в работу");
  }
  await close(x, 1);
}

/** Итоги задачи: почему отменил или что получилось */
export async function setSummary(id: number, summary: string): Promise<void> {
  await updateTask(id, { summary });
}

async function close(x: Task, cancelled = 0): Promise<void> {
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
      if (x.participants.length) await setTaskPeople(nextId, x.participants);
    }
  }
  // Закрытая задача больше никого не ждёт
  await updateTask(x.id, { status: "done", done_at: stamp, next_id: nextId, cancelled, waiting_for: null, waiting_until: null });
}

/** Вернуть сделанную в работу. Если она успела создать следующий повтор и тот ещё не сделан, он убирается */
export async function reopenTask(x: Task): Promise<void> {
  if (x.next_id) {
    const [n] = await (await db()).select<Task[]>("SELECT * FROM tasks WHERE id = $1", [x.next_id]);
    if (n && (n.status === "active" || n.status === "inbox")) await deleteTask(n.id);
  }
  await updateTask(x.id, { status: "active", done_at: null, next_id: null, cancelled: 0 });
}

// Теги. Создаются сами, когда их впервые ставят задаче; цвет подбирается подальше от уже занятых

export async function loadTags(): Promise<Tag[]> {
  const rows = await (await db()).select<Tag[]>("SELECT id, name, color FROM tags");
  return rows.sort((a, b) => byName(a.name, b.name));
}

/** Все имена из задач: кто назначал и кто был участником встречи. Один список на оба поля */
const PEOPLE_SQL = `SELECT assigned_by AS name, id AS task_id FROM tasks WHERE assigned_by IS NOT NULL AND assigned_by <> ''
  UNION SELECT name, task_id FROM task_people
  UNION SELECT waiting_for AS name, id AS task_id FROM tasks WHERE waiting_for IS NOT NULL AND waiting_for <> ''
  UNION SELECT name, -id FROM people`;

/** Все, кто когда-либо назначал задачи или был на встрече: подсказки в полях «Кто назначил» и «Участники» */
export async function loadPeople(): Promise<string[]> {
  const rows = await (await db()).select<{ name: string }[]>(`SELECT DISTINCT name FROM (${PEOPLE_SQL})`);
  const out: string[] = [];
  for (const { name } of rows) if (!out.some((p) => sameName(p, name))) out.push(name);
  return out.sort(byName);
}

/** Раздел «Люди»: все люди из таблицы. Имена из задач, которых там ещё нет, добавляются сами (пустой карточкой) */
export async function loadPeopleList(): Promise<Person[]> {
  const d = await db();
  const names = (await d.select<{ name: string }[]>(`SELECT DISTINCT name FROM (${PEOPLE_SQL})`)).map((r) => r.name.replace(/\s+/g, " ").trim()).filter(Boolean);
  let rows = await d.select<Omit<Person, "tags">[]>("SELECT id, name, phone, telegram, comment, birthday, company, job_title FROM people ORDER BY id");
  let added = false;
  for (const n of names) {
    if (rows.some((r) => sameName(r.name, n))) continue;
    await d.execute("INSERT INTO people (name, created_at) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM people WHERE name = $3)", [n, nowStamp(), n]);
    rows = [...rows, { id: -1, name: n, phone: "", telegram: "", comment: "", birthday: null, company: "", job_title: "" }];
    added = true;
  }
  if (added) rows = await d.select<Omit<Person, "tags">[]>("SELECT id, name, phone, telegram, comment, birthday, company, job_title FROM people ORDER BY id");
  const tagRows = await d.select<(Tag & { person_id: number })[]>(
    "SELECT pt.person_id, t.id, t.name, t.color FROM person_tags pt JOIN tags t ON t.id = pt.tag_id ORDER BY pt.position, t.id",
  );
  const out: Person[] = [];
  for (const r of rows) {
    if (out.some((p) => sameName(p.name, r.name))) {
      // Дубль от двух одновременных загрузок: оставляем первую строку, лишнюю убираем
      await d.execute("DELETE FROM people WHERE id = $1", [r.id]);
      continue;
    }
    out.push({ ...r, tags: tagRows.filter((t) => t.person_id === r.id).map(({ id, name, color }) => ({ id, name, color })) });
  }
  return out.sort((a, b) => byName(a.name, b.name));
}

const cleanName = (raw: string) => raw.replace(/\s+/g, " ").trim();

/** Заменить теги человека: те же правила, что у тегов задачи (новые создаются сами, не больше шести) */
async function setPersonTags(personId: number, names: string[]): Promise<void> {
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
  await d.execute("DELETE FROM person_tags WHERE person_id = $1", [personId]);
  for (const [i, id] of ids.entries()) await d.execute("INSERT INTO person_tags (person_id, tag_id, position) VALUES ($1, $2, $3)", [personId, id, i]);
}

const personCols = (f: PersonFields) => [cleanName(f.name), f.phone.trim(), f.telegram.trim(), f.comment.trim(), f.birthday, f.company.trim(), f.job_title.trim()];

/** Новый человек. Имя, которое уже есть (без учёта регистра), не принимается */
export async function addPerson(f: PersonFields): Promise<number> {
  const d = await db();
  const name = cleanName(f.name);
  if (!name) throw new Error("У человека должно быть имя");
  if ((await loadPeopleList()).some((p) => sameName(p.name, name))) throw new Error(`«${name}» уже есть в списке`);
  const r = await d.execute(
    "INSERT INTO people (name, phone, telegram, comment, birthday, company, job_title, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [...personCols(f), nowStamp()],
  );
  const id = r.lastInsertId ?? 0;
  await setPersonTags(id, f.tags);
  return id;
}

/** Сохранить человека. Если имя изменилось, оно меняется и во всех его задачах */
export async function updatePerson(id: number, f: PersonFields): Promise<void> {
  const d = await db();
  const name = cleanName(f.name);
  if (!name) throw new Error("У человека должно быть имя");
  const all = await loadPeopleList();
  const old = all.find((p) => p.id === id);
  if (!old) throw new Error("Человека уже нет в списке");
  if (all.some((p) => p.id !== id && sameName(p.name, name))) {
    throw new Error(`«${name}» уже есть в списке. Чтобы объединить, удали одного и переназначь его задачи на другого`);
  }
  if (old.name !== name) await renamePerson(old.name, name);
  await d.execute(
    "UPDATE people SET name = $1, phone = $2, telegram = $3, comment = $4, birthday = $5, company = $6, job_title = $7 WHERE id = $8",
    [...personCols(f), id],
  );
  await setPersonTags(id, f.tags);
}

/** Массовая правка: заполненные поля ставятся всем, теги добавляются к тем, что уже есть */
export async function bulkUpdatePeople(ids: number[], patch: { company?: string; job_title?: string; addTags?: string[] }): Promise<void> {
  const d = await db();
  const all = await loadPeopleList();
  for (const id of ids) {
    const p = all.find((x) => x.id === id);
    if (!p) continue;
    if (patch.company != null) await d.execute("UPDATE people SET company = $1 WHERE id = $2", [patch.company.trim(), id]);
    if (patch.job_title != null) await d.execute("UPDATE people SET job_title = $1 WHERE id = $2", [patch.job_title.trim(), id]);
    if (patch.addTags?.length) await setPersonTags(id, [...p.tags.map((t) => t.name), ...patch.addTags]);
  }
}

/** Удалить людей. Их задачи переходят к другому человеку (reassignTo) или становятся «Сам себе» (null) */
export async function deletePeople(ids: number[], reassignTo: string | null): Promise<void> {
  const d = await db();
  const all = await loadPeopleList();
  for (const id of ids) {
    const p = all.find((x) => x.id === id);
    if (!p) continue;
    await renamePerson(p.name, reassignTo);
    await d.execute("DELETE FROM person_tags WHERE person_id = $1", [id]);
    await d.execute("DELETE FROM people WHERE id = $1", [id]);
  }
}

/**
 * Переименовать человека во всех задачах. Если новое имя уже есть у другого, это объединение: задачи переходят к нему
 * в его написании. to = null убирает человека, задачи становятся «Сам себе»
 */
export async function renamePerson(from: string, to: string | null): Promise<void> {
  const d = await db();
  const names = (await d.select<{ name: string }[]>(`SELECT DISTINCT name FROM (${PEOPLE_SQL})`)).map((r) => r.name);
  const clean = to?.replace(/\s+/g, " ").trim() || null;
  // Написание того, к кому объединяем: берём уже существующее, если это другой человек
  const target = clean && !sameName(clean, from) ? names.find((n) => sameName(n, clean)) ?? clean : clean;
  for (const n of names.filter((n) => sameName(n, from))) {
    await d.execute("UPDATE tasks SET assigned_by = $1 WHERE assigned_by = $2", [target, n]);
    await d.execute("UPDATE tasks SET waiting_for = $1 WHERE waiting_for = $2", [target, n]);
    // В участниках: если человек уже есть на встрече под новым именем, вторая строка не нужна
    if (target) await d.execute("UPDATE OR IGNORE task_people SET name = $1 WHERE name = $2", [target, n]);
    if (n !== target) await d.execute("DELETE FROM task_people WHERE name = $1", [n]);
  }
}

/** Заменить участников встречи. Имена сверяются без учёта регистра, повторы отбрасываются */
export async function setTaskPeople(taskId: number, names: string[]): Promise<void> {
  const d = await db();
  const clean: string[] = [];
  for (const raw of names) {
    const n = raw.replace(/\s+/g, " ").trim();
    if (n && !clean.some((c) => sameName(c, n))) clean.push(n);
  }
  await d.execute("DELETE FROM task_people WHERE task_id = $1", [taskId]);
  for (const [i, n] of clean.entries()) await d.execute("INSERT INTO task_people (task_id, name, position) VALUES ($1, $2, $3)", [taskId, n, i]);
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
  await d.execute("DELETE FROM person_tags WHERE tag_id = $1", [id]);
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

/**
 * Связать задачу с другой. «Заблокирована» записывается как «блокирует» с другой стороны, поэтому у второй задачи
 * парная связь появляется сама. Возвращает текст ошибки, если связь не получится (цикл, уже связаны)
 */
export async function addRelation(self: number, other: number, kind: RelationKind): Promise<string | null> {
  const d = await db();
  const rows = await d.select<RelationRow[]>("SELECT id, from_id, to_id, kind FROM task_relations");
  if (self === other) return "Задачу нельзя связать с самой собой";
  if (rows.some((r) => (r.from_id === self && r.to_id === other) || (r.from_id === other && r.to_id === self)))
    return "Эти задачи уже связаны. Сначала убери старую связь";
  const row = rowFor(self, other, kind);
  if (row.kind === "blocks" && wouldCycle(rows, row.from_id, row.to_id)) return "Получится цикл: эти задачи уже блокируют друг друга";
  await d.execute("INSERT INTO task_relations (from_id, to_id, kind) VALUES ($1, $2, $3)", [row.from_id, row.to_id, row.kind]);
  return null;
}

/** Убрать связь: она исчезает у обеих задач */
export async function removeRelation(id: number): Promise<void> {
  await (await db()).execute("DELETE FROM task_relations WHERE id = $1", [id]);
}
