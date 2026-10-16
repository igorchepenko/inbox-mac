-- Люди: карточка человека с контактами. Связь с задачами по-прежнему по имени (tasks.assigned_by, task_people.name),
-- строка здесь появляется сама для каждого имени из задач и по кнопке «Добавить человека».
-- birthday: «ММ-ДД» без года или «ГГГГ-ММ-ДД». Теги те же, что у задач (таблица tags).
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  telegram TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  birthday TEXT,
  company TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS people_name ON people(name);
CREATE TABLE IF NOT EXISTS person_tags (
  person_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, tag_id)
);
CREATE INDEX IF NOT EXISTS person_tags_tag ON person_tags(tag_id);
