-- Отмена и итоги. Отменённая задача закрыта так же, как сделанная (status done, потом archived, done_at — когда закрыли),
-- но с пометкой cancelled = 1: так архив, повторы и списки работают для неё без отдельной ветки.
-- summary — итоги в свободной форме: почему отменил или что получилось. Пишутся при закрытии, правятся в панели задачи

ALTER TABLE tasks ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN summary TEXT NOT NULL DEFAULT '';
