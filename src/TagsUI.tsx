// Теги и «Кто назначил» в интерфейсе: чипсы, поля ввода с подсказками, правка тега, фильтр списка.
// Поля работают и в правой панели, и в форме записи задачи (⌥Space и N)
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ListFilter, Search, Sparkles, UserRound, X } from "lucide-react";
import type { Project, Tag, TagPatch } from "./db";
import { Icon } from "./icons";
import { PALETTE } from "./palette";
import { addTagName, canonicalPerson, EMPTY_FILTER, filterOn, NO_PERSON, NO_SPACE, pickColor, sameName, suggest, TAG_COLORS, TAG_MAX, TAG_MAX_LEN, type TaskFilter } from "./tags";
import { ColorGrid, Popover } from "./widgets";
import { tips } from "./fields";
import { plural, SMART, type ViewId } from "./views";

/** Умный список в фильтрах раздела «Задачи»: null — все задачи */
export interface SmartFilter {
  value: ViewId | null;
  onChange: (v: ViewId | null) => void;
}

const tagVars = (color: string | undefined) => ({ "--c": color ? `var(--${color})` : "var(--muted)" }) as CSSProperties;
export const colorOf = (tags: Tag[], name: string) => tags.find((t) => sameName(t.name, name))?.color;

/** Чипс тега: точка его цвета и название на лёгкой заливке того же цвета */
export function TagChip(props: { name: string; color?: string; onRemove?: () => void; title?: string }) {
  return (
    <span className={`tchip ${props.color ? "" : "new"}`} style={tagVars(props.color)} title={props.title}>
      <i className="tdot" />
      <span className="tchip-n">{props.name}</span>
      {props.onRemove && (
        <button type="button" className="tchip-x" aria-label={`Убрать тег ${props.name}`}
          onMouseDown={(e) => e.preventDefault()} onClick={(e) => (e.stopPropagation(), props.onRemove!())}><X size={10} strokeWidth={2.6} /></button>
      )}
    </span>
  );
}

/** Теги задачи в строке списка: первые три, остальные числом */
export function TagChips({ tags, max = 3 }: { tags: Tag[]; max?: number }) {
  if (!tags.length) return null;
  const rest = tags.length - max;
  return (
    <span className="tchips">
      {tags.slice(0, rest > 0 ? max : tags.length).map((t) => <TagChip key={t.id} name={t.name} color={t.color} title={tips.tag(t.name)} />)}
      {rest > 0 && <span className="meta" title={tips.tagsRest(tags.slice(max).map((t) => t.name))}>+{rest}</span>}
    </span>
  );
}

/** Кто назначил: маленькая подпись с иконкой человека */
export function Assignee({ name }: { name: string }) {
  return <span className="meta who" title={`Назначил: ${name}`}><UserRound size={11} /><span className="who-n">{name}</span></span>;
}

/** Подсказки под полем. Не всплывают поверх, а занимают место: окно ⌥Space подстраивает высоту под содержимое */
function Suggestions(props: { items: string[]; hi: number; colors?: (name: string) => string | undefined; onPick: (v: string) => void; person?: boolean }) {
  if (!props.items.length) return null;
  return (
    <div className="sugg" role="listbox">
      {props.items.map((o, i) => (
        <button type="button" key={o} role="option" aria-selected={i === props.hi} className={`sugg-i ${i === props.hi ? "hi" : ""}`}
          onMouseDown={(e) => e.preventDefault()} onClick={() => props.onPick(o)}>
          {props.person ? <><UserRound size={11} /> {o}</> : <TagChip name={o} color={props.colors?.(o)} />}
        </button>
      ))}
    </div>
  );
}

/** Ход по подсказкам стрелками. -1 — ничего не выделено, Enter берёт набранный текст */
function useHi(count: number) {
  const [hi, setHi] = useState(-1);
  useEffect(() => setHi((h) => Math.min(h, count - 1)), [count]);
  const onArrow = (e: React.KeyboardEvent) => {
    if (!count || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return false;
    e.preventDefault();
    setHi((h) => (e.key === "ArrowDown" ? (h + 1) % count : h <= 0 ? count - 1 : h - 1));
    return true;
  };
  return { hi, setHi, onArrow };
}

/**
 * Теги задачи: чипсы с крестиком и поле для нового. Enter, запятая или Tab добавляют, Backspace в пустом поле убирает последний.
 * Подсказки из уже существующих тегов; новый тег показывается сразу с тем цветом, который получит при сохранении
 */
export function TagInput(props: { value: string[]; tags: Tag[]; onChange: (names: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const full = props.value.length >= TAG_MAX;
  const items = focus && !full ? suggest(props.tags.map((t) => t.name), text, props.value) : [];
  const { hi, setHi, onArrow } = useHi(items.length);
  // Цвет нового тега считается тем же правилом, что при сохранении (db.setTaskTags), поэтому чипс сразу цветной
  const colors = new Map<string, string>();
  const used = props.tags.map((t) => t.color);
  for (const n of props.value) {
    if (colorOf(props.tags, n)) continue;
    const c = pickColor(used);
    used.push(c);
    colors.set(n, c);
  }
  const colorFor = (n: string) => colorOf(props.tags, n) ?? colors.get(n);
  const add = (raw: string) => {
    const next = addTagName(props.value, raw);
    if (next !== props.value) props.onChange(next);
    setText("");
    setHi(-1);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (onArrow(e)) return;
    // Enter берёт набранное как есть (так создаётся новый тег), Tab дополняет первой подсказкой
    const pick = hi >= 0 ? items[hi] : e.key === "Tab" && text.trim() && items[0] ? items[0] : text;
    if ((e.key === "Enter" || e.key === "," || (e.key === "Tab" && pick.trim())) && pick.trim()) {
      e.preventDefault();
      e.stopPropagation(); // Enter в поле тега не сохраняет всю форму
      add(pick);
    } else if (e.key === "Backspace" && !text && props.value.length) props.onChange(props.value.slice(0, -1));
    else if (e.key === "Escape" && text) (e.stopPropagation(), e.preventDefault(), setText(""));
  };
  return (
    <div className="tag-field">
      <div className={`tag-input field ${props.disabled ? "disabled" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), input.current?.focus())}>
        {props.value.map((n) => (
          <TagChip key={n} name={n} color={colorFor(n)} title={colorOf(props.tags, n) ? undefined : "Новый тег"}
            onRemove={props.disabled ? undefined : () => props.onChange(props.value.filter((x) => x !== n))} />
        ))}
        {!full && !props.disabled && (
          <input ref={input} value={text} maxLength={TAG_MAX_LEN + 1} spellCheck={false} autoComplete="off"
            placeholder={props.value.length ? "" : "Добавить тег"}
            onChange={(e) => (setText(e.target.value.replace(/,/g, "")), setHi(-1))}
            onFocus={() => setFocus(true)}
            onBlur={() => (setFocus(false), text.trim() && add(text))}
            onKeyDown={onKey} />
        )}
        {full && <span className="tag-full">не больше {TAG_MAX}</span>}
      </div>
      <Suggestions items={items} hi={hi} colors={(n) => colorOf(props.tags, n)} onPick={add} />
    </div>
  );
}

/** Кто назначил задачу. Подсказки из имён, которые уже вводил; «андрей» станет «Андрей», если так писал раньше */
export function PersonInput(props: { value: string | null; people: string[]; onChange: (v: string | null) => void; disabled?: boolean }) {
  const [text, setText] = useState(props.value ?? "");
  const [focus, setFocus] = useState(false);
  useEffect(() => setText(props.value ?? ""), [props.value]);
  const exact = props.people.some((p) => p === text.trim());
  const items = focus && !exact ? suggest(props.people, text) : [];
  const { hi, setHi, onArrow } = useHi(items.length);
  const commit = (raw: string) => {
    const v = canonicalPerson(raw, props.people);
    setText(v ?? "");
    setHi(-1);
    if (v !== props.value) props.onChange(v);
  };
  return (
    <div className="tag-field">
      <label className={`person-input field ${props.disabled ? "disabled" : ""}`}>
        <UserRound size={13} />
        <input value={text} maxLength={40} spellCheck={false} autoComplete="off" disabled={props.disabled}
          placeholder="Кто назначил, например Андрей"
          onChange={(e) => (setText(e.target.value), setHi(-1))}
          onFocus={() => setFocus(true)}
          onBlur={() => (setFocus(false), commit(text))}
          onKeyDown={(e) => {
            if (onArrow(e)) return;
            if (e.key === "Enter" || (e.key === "Tab" && hi >= 0)) {
              e.preventDefault();
              e.stopPropagation();
              commit(hi >= 0 ? items[hi] : text);
            }
          }} />
        {props.value && !props.disabled && (
          <button type="button" className="tchip-x" aria-label="Убрать" onMouseDown={(e) => e.preventDefault()} onClick={() => commit("")}><X size={11} /></button>
        )}
      </label>
      <Suggestions items={items} hi={hi} onPick={commit} person />
    </div>
  );
}

/** Участники встречи: несколько имён чипсами. Подсказки из того же списка, что «Кто назначил», новое имя попадает туда же */
export function PeopleInput(props: { value: string[]; people: string[]; onChange: (names: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const items = focus ? suggest(props.people, text, props.value) : [];
  const { hi, setHi, onArrow } = useHi(items.length);
  const add = (raw: string) => {
    const v = canonicalPerson(raw, props.people);
    setText("");
    setHi(-1);
    if (v && !props.value.some((n) => sameName(n, v))) props.onChange([...props.value, v]);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (onArrow(e)) return;
    const pick = hi >= 0 ? items[hi] : e.key === "Tab" && text.trim() && items[0] ? items[0] : text;
    if ((e.key === "Enter" || e.key === "," || (e.key === "Tab" && pick.trim())) && pick.trim()) {
      e.preventDefault();
      e.stopPropagation(); // Enter в поле участников не сохраняет всю форму
      add(pick);
    } else if (e.key === "Backspace" && !text && props.value.length) props.onChange(props.value.slice(0, -1));
    else if (e.key === "Escape" && text) (e.stopPropagation(), e.preventDefault(), setText(""));
  };
  return (
    <div className="tag-field">
      <div className={`tag-input field people-input ${props.disabled ? "disabled" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), input.current?.focus())}>
        {props.value.map((n) => (
          <span key={n} className="tchip person">
            <UserRound size={11} />
            <span className="tchip-n">{n}</span>
            {!props.disabled && (
              <button type="button" className="tchip-x" aria-label={`Убрать ${n}`} onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => (e.stopPropagation(), props.onChange(props.value.filter((x) => x !== n)))}><X size={10} strokeWidth={2.6} /></button>
            )}
          </span>
        ))}
        {!props.disabled && (
          <input ref={input} value={text} maxLength={40} spellCheck={false} autoComplete="off"
            placeholder={props.value.length ? "" : "Кто будет, например Андрей"}
            onChange={(e) => (setText(e.target.value.replace(/,/g, "")), setHi(-1))}
            onFocus={() => setFocus(true)}
            onBlur={() => (setFocus(false), text.trim() && add(text))}
            onKeyDown={onKey} />
        )}
      </div>
      <Suggestions items={items} hi={hi} onPick={add} person />
    </div>
  );
}

const TAG_SWATCHES = TAG_COLORS.map((id) => PALETTE.find((s) => s.id === id)!);

/** Правка тега во всплывающей панели: название, цвет из 24, удаление */
export function TagEditor(props: {
  tag: Tag;
  anchor: HTMLElement;
  onClose: () => void;
  onSave: (patch: TagPatch) => Promise<string | null>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(props.tag.name);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const saveName = async () => {
    const v = name.trim();
    if (!v || v === props.tag.name) return setName(props.tag.name);
    const err = await props.onSave({ name: v });
    setError(err);
    if (err) setName(props.tag.name);
  };
  return (
    <Popover anchor={props.anchor} onClose={props.onClose} width={292}>
      <div className="lbl">Тег</div>
      <input className="field tag-name" value={name} maxLength={TAG_MAX_LEN} spellCheck={false} autoFocus
        onChange={(e) => (setName(e.target.value), setError(null))} onBlur={saveName}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())} />
      {error && <div className="tag-err">{error}</div>}
      <div className="lbl sub-lbl">Цвет</div>
      <ColorGrid colors={TAG_SWATCHES} label="Цвет тега" value={props.tag.color} onPick={(color) => props.onSave({ color })} />
      <button type="button" className={`link danger tag-del ${armed ? "armed" : ""}`} onBlur={() => setArmed(false)}
        onClick={() => (armed ? props.onDelete() : setArmed(true))}>
        {armed ? "Точно удалить? Задачи останутся" : "Удалить тег"}
      </button>
    </Popover>
  );
}

/** Пространство в фильтре: иконка его цвета и название */
function SpaceChip({ project: p, on, onClick, onRemove }: { project?: Project; on?: boolean; onClick?: () => void; onRemove?: () => void }) {
  const body = (
    <>
      {p ? <span className="fsp-ic" style={{ color: `var(--${p.color})` }}><Icon name={p.icon} size={12} /></span> : null}
      {p?.name ?? "Без пространства"}
    </>
  );
  if (onRemove)
    return (
      <span className="fchip person space on static">
        {body}
        <button type="button" className="tchip-x" aria-label="Убрать" onClick={onRemove}><X size={10} strokeWidth={2.6} /></button>
      </span>
    );
  return <button type="button" className={`fchip person space ${on ? "on" : ""}`} onClick={onClick}>{body}</button>;
}

const toggle = (xs: number[], id: number) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]);

/** ⌘F фокусирует поле поиска того экрана, который сейчас открыт: список, доска, календарь, пространства */
export const FIND_EVENT = "inbox:find";

/**
 * Поиск в шапке рядом с сортировкой и фильтрами. Ищет только в том, что сейчас на экране, и складывается с фильтрами.
 * Esc сначала стирает запрос, потом уводит фокус; стрелки двигают выбор в списке, не выходя из поля
 */
export function SearchField(props: { value: string; onChange: (v: string) => void; placeholder: string; tip?: string; onArrow?: (dir: 1 | -1) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const find = () => requestAnimationFrame(() => input.current?.select());
    window.addEventListener(FIND_EVENT, find);
    return () => window.removeEventListener(FIND_EVENT, find);
  }, []);
  return (
    <label className={`fsearch ${props.value ? "has" : ""}`} data-tip={props.tip} data-key={props.tip ? "⌘F" : undefined}>
      <Search size={13} />
      <input ref={input} value={props.value} placeholder={props.placeholder} spellCheck={false} autoComplete="off" aria-label={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") return e.preventDefault(), e.stopPropagation(), props.value ? props.onChange("") : e.currentTarget.blur();
          if (e.key === "Enter") return e.preventDefault(), e.currentTarget.blur();
          if (props.onArrow && (e.key === "ArrowDown" || e.key === "ArrowUp")) return e.preventDefault(), e.stopPropagation(), props.onArrow(e.key === "ArrowDown" ? 1 : -1);
        }} />
      {props.value && (
        <button type="button" className="fsearch-x" aria-label="Очистить поиск" onMouseDown={(e) => e.preventDefault()} onClick={() => props.onChange("")}><X size={12} /></button>
      )}
    </label>
  );
}

/** Кнопка «Фильтры» в шапке: пространства и теги (любое из выбранных) и кто назначил. Внутри пространства его фильтра нет */
export function FilterButton(props: {
  filter: TaskFilter; projects: Project[]; tags: Tag[]; people: string[]; lockTag?: number; noSpaces?: boolean; onChange: (f: TaskFilter) => void;
  smart?: SmartFilter;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { filter: f } = props;
  // Запрос поиска виден в своём поле, в счётчик кнопки не входит
  const n = f.spaces.length + f.tags.length + (f.person !== null ? 1 : 0) + (props.smart?.value ? 1 : 0);
  const tags = props.tags.filter((t) => t.id !== props.lockTag);
  const toggleTag = (id: number) => props.onChange({ ...f, tags: toggle(f.tags, id) });
  const toggleSpace = (id: number) => props.onChange({ ...f, spaces: toggle(f.spaces, id) });
  const setPerson = (p: string | null) => props.onChange({ ...f, person: f.person === p ? null : p });
  return (
    <>
      <button className={`icon-btn ${n ? "on" : ""}`} data-tip={props.noSpaces ? "Фильтры по тегам и тому, кто назначил" : "Фильтры по пространствам, тегам и тому, кто назначил"}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <ListFilter size={13} /> Фильтры{n > 0 && <span className="fcount">{n}</span>}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={320}>
          {props.smart && (
            <>
              <div className="lbl">Умный список <span className="opt">готовая подборка задач</span></div>
              <div className="seg">
                {SMART.map((x) => (
                  <button type="button" key={x.id} className={`fchip person ${props.smart!.value === x.id ? "on" : ""}`}
                    onClick={() => props.smart!.onChange(props.smart!.value === x.id ? null : x.id)}>
                    <Sparkles size={11} /> {x.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {!props.noSpaces && (
            <>
              <div className={`lbl ${props.smart ? "sub-lbl" : ""}`}>Пространства <span className="opt">задачи из любого выбранного</span></div>
              <div className="seg">
                {props.projects.map((p) => <SpaceChip key={p.id} project={p} on={f.spaces.includes(p.id)} onClick={() => toggleSpace(p.id)} />)}
                <SpaceChip on={f.spaces.includes(NO_SPACE)} onClick={() => toggleSpace(NO_SPACE)} />
              </div>
            </>
          )}
          <div className={`lbl ${props.noSpaces ? "" : "sub-lbl"}`}>Теги <span className="opt">задачи с любым из выбранных</span></div>
          <div className="seg">
            {tags.map((t) => (
              <button type="button" key={t.id} className={`fchip ${f.tags.includes(t.id) ? "on" : ""}`} onClick={() => toggleTag(t.id)}>
                <TagChip name={t.name} color={t.color} />
              </button>
            ))}
            {!tags.length && <span className="hint">Тегов пока нет. Их ставят в панели задачи или #тегом в названии</span>}
          </div>
          <div className="lbl sub-lbl">Кто назначил</div>
          <div className="seg">
            {props.people.map((p) => (
              <button type="button" key={p} className={`fchip person ${f.person !== null && sameName(f.person, p) ? "on" : ""}`} onClick={() => setPerson(p)}>
                <UserRound size={11} /> {p}
              </button>
            ))}
            <button type="button" className={`fchip person ${f.person === NO_PERSON ? "on" : ""}`} onClick={() => setPerson(NO_PERSON)}>Сам себе</button>
          </div>
          {n > 0 && <button type="button" className="link tag-del" onClick={() => (props.onChange({ ...EMPTY_FILTER, text: f.text }), props.smart?.onChange(null))}>Сбросить фильтры</button>}
        </Popover>
      )}
    </>
  );
}

/** Что сейчас отфильтровано: под шапкой, у каждого условия крестик */
export function FilterBar(props: { filter: TaskFilter; projects: Project[]; tags: Tag[]; shown?: number; onChange: (f: TaskFilter) => void; smart?: SmartFilter }) {
  const { filter: f, smart } = props;
  const smartName = smart?.value ? SMART.find((x) => x.id === smart.value)?.name : undefined;
  if (!filterOn(f) && !smartName) return null;
  return (
    <div className="filter-bar">
      <ListFilter size={13} />
      {smartName && (
        <span className="fchip person on static" data-tip="Умный список. Крестик покажет все задачи">
          <Sparkles size={11} /> {smartName}
          <button type="button" className="tchip-x" aria-label="Показать все задачи" onClick={() => smart!.onChange(null)}><X size={10} strokeWidth={2.6} /></button>
        </span>
      )}
      {f.text.trim() && (
        <span className="fchip person on static">
          <Search size={11} /> «{f.text.trim()}»
          <button type="button" className="tchip-x" aria-label="Убрать поиск" onClick={() => props.onChange({ ...f, text: "" })}><X size={10} strokeWidth={2.6} /></button>
        </span>
      )}
      {f.spaces.map((id) => {
        const p = props.projects.find((x) => x.id === id);
        return (id === NO_SPACE || p) && <SpaceChip key={`s${id}`} project={p} onRemove={() => props.onChange({ ...f, spaces: f.spaces.filter((x) => x !== id) })} />;
      })}
      {f.tags.map((id) => {
        const t = props.tags.find((x) => x.id === id);
        return t && <TagChip key={id} name={t.name} color={t.color} onRemove={() => props.onChange({ ...f, tags: f.tags.filter((x) => x !== id) })} />;
      })}
      {f.person !== null && (
        <span className="fchip person on static">
          <UserRound size={11} /> {f.person === NO_PERSON ? "Сам себе" : f.person}
          <button type="button" className="tchip-x" aria-label="Убрать" onClick={() => props.onChange({ ...f, person: null })}><X size={10} strokeWidth={2.6} /></button>
        </span>
      )}
      {props.shown != null && <span className="meta">{props.shown ? `показано ${plural(props.shown, "задача", "задачи", "задач")}` : "ничего не подходит"}</span>}
      <button type="button" className="link" onClick={() => (props.onChange(EMPTY_FILTER), smart?.onChange(null))}>сбросить</button>
    </div>
  );
}

