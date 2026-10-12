-- Участники встречи: имена из того же списка, что «Кто назначил». Порядок как добавлены.
-- Имя без учёта регистра сверяется в приложении: NOCASE в SQLite не знает кириллицу
CREATE TABLE IF NOT EXISTS task_people (
  task_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, name)
);
CREATE INDEX IF NOT EXISTS task_people_name ON task_people(name);
