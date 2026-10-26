import { useState, type CSSProperties } from "react";
import { Pencil, Plus } from "lucide-react";
import type { Tag, TagPatch, Task } from "./db";
import { countFor, plural, type ViewId } from "./views";
import { searchNames } from "./search";
import { NewTag, SearchField, TagEditor } from "./TagsUI";

/** Все теги карточками: название, сколько открытых задач; правка и создание как в меню */
export default function TagsPage(props: {
  tags: Tag[];
  tasks: Task[];
  onOpen: (v: ViewId) => void;
  onCreate: (name: string) => Promise<string | null>;
  onSave: (id: number, patch: TagPatch) => Promise<string | null>;
  onDelete: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<{ id: number; el: HTMLElement } | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const cards = searchNames(query, props.tags);
  const editing = edit && props.tags.find((t) => t.id === edit.id);
  const used = new Set(props.tasks.flatMap((x) => x.tags.map((t) => t.id)));
  return (
    <div className="pp">
      <header className="pp-head" data-tauri-drag-region>
        <div>
          <h2>Теги</h2>
          <p>
            {props.tags.length ? plural(props.tags.length, "тег", "тега", "тегов") : "Пока ни одного тега"}
            {props.tags.length > used.size && <> · {props.tags.length - used.size} без задач</>}
          </p>
        </div>
        {props.tags.length > 0 && <SearchField value={query} onChange={setQuery} placeholder="Найти тег" tip="Поиск по названию тега" />}
        <button className="cta stand narrow" onClick={(e) => setAdding(e.currentTarget)}><Plus size={14} /> Новый тег</button>
      </header>
      <div className="pp-grid">
        {cards.map((t) => {
          const id: ViewId = `t:${t.id}`;
          const n = countFor(id, props.tasks);
          return (
            <div key={t.id} className="pp-card tg-card" role="button" tabIndex={0} style={{ "--c": `var(--${t.color})` } as CSSProperties}
              onClick={() => props.onOpen(id)} onKeyDown={(e) => e.key === "Enter" && props.onOpen(id)}>
              <div className="pp-top">
                <span className="pp-icon"><i className="tdot" /></span>
                <b className="pp-name" title={t.name}>{t.name}</b>
                <button className="pp-edit" data-tip="Изменить тег" aria-label="Изменить тег"
                  onClick={(e) => (e.stopPropagation(), setEdit({ id: t.id, el: e.currentTarget }))}><Pencil size={13} /></button>
              </div>
              <div className="pp-stats"><span><b>{n}</b> {n === 1 ? "открытая задача" : "открытых задач"}</span></div>
            </div>
          );
        })}
        {query.trim() && !cards.length && <div className="pp-none">Ничего не нашлось. Ищу по названию тега.</div>}
        <button className="pp-card pp-new" onClick={(e) => setAdding(e.currentTarget)}><Plus size={18} /> Новый тег</button>
      </div>
      {adding && <NewTag anchor={adding} onClose={() => setAdding(null)} onCreate={props.onCreate} />}
      {editing && edit && (
        <TagEditor key={editing.id} tag={editing} anchor={edit.el} onClose={() => setEdit(null)}
          onSave={(p) => props.onSave(editing.id, p)} onDelete={() => (setEdit(null), props.onDelete(editing.id))} />
      )}
    </div>
  );
}
