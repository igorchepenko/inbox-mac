-- ФИО человека тремя полями. people.name остаётся «как показываем» (Имя Фамилия или Фамилия Имя Отчество):
-- по нему задачи привязаны к человеку (tasks.assigned_by, task_people.name), поэтому задачи не трогаем.
-- У уже сохранённых весь текст переносим в «имя», дальше пользователь поправит сам.
ALTER TABLE people ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE people ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE people ADD COLUMN middle_name TEXT NOT NULL DEFAULT '';
UPDATE people SET first_name = name;
