-- Расширение задачи: время «от–до», квадрант Эйзенхауэра, повторы, подзадачи, ссылки, файлы

ALTER TABLE tasks ADD COLUMN start_time TEXT;   -- HH:MM, начало в день due_date
ALTER TABLE tasks ADD COLUMN end_time   TEXT;   -- HH:MM, конец в тот же день; без start_time не бывает
ALTER TABLE tasks ADD COLUMN quadrant   INTEGER; -- NULL не задан; 1 срочно и важно, 2 важно, не срочно, 3 срочно, не важно, 4 ни то ни другое
ALTER TABLE tasks ADD COLUMN recurrence TEXT;   -- правило повтора в JSON (src/recurrence.ts), NULL без повтора
ALTER TABLE tasks ADD COLUMN series_id  INTEGER; -- id первой задачи серии повторов
ALTER TABLE tasks ADD COLUMN next_id    INTEGER; -- у сделанной повторяющейся: следующая созданная задача

CREATE TABLE subtasks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title    TEXT    NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_subtasks_task ON subtasks(task_id);

CREATE TABLE links (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    url      TEXT    NOT NULL,
    title    TEXT    NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_links_task ON links(task_id);

-- Файлы копируются в папку приложения (attachments/<task_id>/), здесь путь к копии
CREATE TABLE attachments (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    name     TEXT    NOT NULL,
    path     TEXT    NOT NULL,
    size     INTEGER NOT NULL DEFAULT 0,
    added_at TEXT    NOT NULL
);
CREATE INDEX idx_attachments_task ON attachments(task_id);
