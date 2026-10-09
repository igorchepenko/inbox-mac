-- Палитра проектов выросла до 32 цветов. Серый «графит» в неё не вошёл: проекты с ним получают чистый сланцевый
UPDATE projects SET color = 'slate' WHERE color = 'graphite';
