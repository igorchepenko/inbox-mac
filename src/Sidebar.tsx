import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronsUpDown, Keyboard, LayoutGrid, Plus, Search, Settings as Gear, Users, X } from "lucide-react";
import type { Project, Tag, TagPatch, Task } from "./db";
import { TagEditor } from "./TagsUI";
import { ALWAYS, countFor, HOTKEY_VIEWS, isSmart, VIEWS, type ViewId } from "./views";
import { Icon } from "./icons";
import { IconGrid, Popover, ThemeSwitch } from "./widgets";
import { HomeIcon } from "./home/Home";
import { spaceVars } from "./palette";
import { activeProfile, PROFILES, profileName, switchProfile } from "./profile";

export const KEY_PROJECTS_COLLAPSED = "side.projects.collapsed";
export const KEY_TAGS_COLLAPSED = "side.tags.collapsed";
/** ⌘P из любого места: развернуть проекты и поставить курсор в поиск */
export const FIND_PROJECT_EVENT = "inbox:find-project";

export function viewIcon(id: ViewId, settings: Record<string, string>): string {
  return settings[`icon:${id}`] ?? VIEWS.find((v) => v.id === id)?.icon ?? "folder";
}

// Набрал «ьщтуэ» вместо «money»: ищем и в другой раскладке
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = "йцукенгшщзхъфывапролджэячсмитьбюё";
const swapLayout = (s: string) =>
  [...s].map((ch) => {
    const i = EN.indexOf(ch);
    if (i >= 0) return RU[i];
    const j = RU.indexOf(ch);
    return j >= 0 ? EN[j] : ch;
  }).join("");

/**
 * Поиск пространства. Раньше короткий запрос находил лишнее: «б» в другой раскладке это «,», и любое описание
 * с запятой совпадало. Теперь другую раскладку берём, только если там буквы или цифры, по названию ищем
 * начало слова (с 3 символов и середину), по описанию только начало слова и только с 3 символов.
 */
export function matchProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  if (!q) return projects;
  const alt = swapLayout(q);
  const qs = /^[\p{L}\p{N}\s-]+$/u.test(alt) && alt !== q ? [q, alt] : [q];
  const wordStart = (text: string, w: string) => text.startsWith(w) || text.includes(` ${w}`) || text.includes(`-${w}`);
  const score = (p: Project) => {
    const n = p.name.toLowerCase();
    const d = p.description.toLowerCase();
    if (qs.some((w) => n.startsWith(w))) return 0;
    if (qs.some((w) => wordStart(n, w))) return 1;
    if (q.length >= 3 && qs.some((w) => n.includes(w))) return 2;
    if (q.length >= 3 && qs.some((w) => wordStart(d, w))) return 3;
    return -1;
  };
  return projects
    .map((p) => [p, score(p)] as const)
    .filter(([, s]) => s >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([p]) => p);
}

export function Sidebar(props: {
  view: ViewId;
  tasks: Task[];
  projects: Project[];
  tags: Tag[];
  peopleCount: number;
  settings: Record<string, string>;
  onOpen: (v: ViewId) => void;
  onTagSave: (id: number, patch: TagPatch) => Promise<string | null>;
  onTagDelete: (id: number) => void;
  onNewProject: () => void;
  onEditProject: (p: Project) => void;
  onViewIcon: (id: ViewId, icon: string) => void;
  onSetting: (key: string, value: string) => void;
  onSettings: () => void;
  onShortcuts: () => void;
}) {
  const cur = props.view;
  // Пункт меню, у которого сейчас открыт выбор иконки
  const [picker, setPicker] = useState<{ id: ViewId; el: HTMLElement } | null>(null);
  const [collapsed, setCollapsed] = useState(props.settings[KEY_PROJECTS_COLLAPSED] === "1");
  useEffect(() => setCollapsed(props.settings[KEY_PROJECTS_COLLAPSED] === "1"), [props.settings[KEY_PROJECTS_COLLAPSED]]); // eslint-disable-line react-hooks/exhaustive-deps
  const tagsFolded = props.settings[KEY_TAGS_COLLAPSED] === "1";
  const [tagEdit, setTagEdit] = useState<{ id: number; el: HTMLElement } | null>(null);
  const editing = tagEdit && props.tags.find((t) => t.id === tagEdit.id);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const found = useMemo(() => matchProjects(props.projects, query), [props.projects, query]);

  const setFolded = (v: boolean) => {
    setCollapsed(v);
    props.onSetting(KEY_PROJECTS_COLLAPSED, v ? "1" : "0");
  };

  useEffect(() => {
    const find = () => {
      if (collapsed) setFolded(false);
      requestAnimationFrame(() => search.current?.focus());
    };
    window.addEventListener(FIND_PROJECT_EVENT, find);
    return () => window.removeEventListener(FIND_PROJECT_EVENT, find);
  });

  const jump = (p: Project | undefined) => {
    if (!p) return;
    props.onOpen(`p:${p.id}`);
    setQuery("");
    search.current?.blur();
  };

  // У пространства пункт целиком залит его цветом, иконка и название белые или чёрные (см. nav.css .nav.space)
  const item = (id: ViewId, label: string, accent: string, icon: string, onIcon: (el: HTMLElement) => void, key?: string, extra = "", space = false) => {
    const n = countFor(id, props.tasks);
    return (
      <div key={id} className={`nav ${cur === id ? "on" : ""} ${space ? "space" : ""} ${extra}`} onClick={() => props.onOpen(id)} role="button"
        data-tip={key ? label : undefined} data-key={key} style={space ? spaceVars(accent) : undefined}>
        <button className="nav-icon" data-tip={space ? "Изменить пространство" : "Сменить иконку"} style={space ? undefined : { color: `var(--${accent})` }}
          onClick={(e) => (e.stopPropagation(), onIcon(e.currentTarget))}>
          <Icon name={icon} size={15} />
        </button>
        <span className="nav-name">{label}</span>
        <span className="n">{n || ""}</span>
      </div>
    );
  };
  const pickerView = picker && VIEWS.find((v) => v.id === picker.id);
  const visibleViews = VIEWS.map((v) => ({ v, key: HOTKEY_VIEWS.includes(v) ? `⌘${HOTKEY_VIEWS.indexOf(v) + 1}` : undefined })).filter(({ v }) => ALWAYS.includes(v.id) || props.settings[`hidden:${v.id}`] !== "1");

  return (
    <nav className="side">
      <div className={`nav ${cur === "home" ? "on" : ""}`} onClick={() => props.onOpen("home")} role="button"
        data-tip="Дашборд" data-key="⌘0">
        <span className="nav-icon"><HomeIcon /></span>
        <span className="nav-name">Дашборд</span>
      </div>
      {/* Умные списки стоят под «Задачами» с отступом: это тот же раздел с готовым фильтром */}
      {visibleViews.map(({ v, key }) =>
        item(v.id, v.name, v.accent, viewIcon(v.id, props.settings), (el) => setPicker({ id: v.id, el }), key, isSmart(v.id) ? "smart" : ""))}

      <div className={`nav ${cur === "people" ? "on" : ""}`} onClick={() => props.onOpen("people")} role="button"
        data-tip="Люди: контакты, теги и дни рождения" data-key="⌘8">
        <span className="nav-icon" style={{ color: "var(--stand)" }}><Users size={15} /></span>
        <span className="nav-name">Люди</span>
        <span className="n">{props.peopleCount || ""}</span>
      </div>

      <div className="side-div" role="separator" />

      <div className="sec-row">
        <button className="sec-toggle" aria-expanded={!collapsed} onClick={() => setFolded(!collapsed)}
          data-tip={collapsed ? "Показать пространства" : "Свернуть пространства"}>
          <ChevronDown size={13} className={`chev ${collapsed ? "folded" : ""}`} />
          <span>Пространства</span>
          {collapsed && props.projects.length > 0 && <span className="sec-n">{props.projects.length}</span>}
        </button>
        <button className={`sec-btn ${cur === "projects" ? "on" : ""}`} onClick={() => props.onOpen("projects")}
          data-tip="Все пространства карточками" data-key="⌘7" aria-label="Все пространства">
          <LayoutGrid size={14} />
        </button>
      </div>

      {!collapsed && (<>
        <button className="nav add-project" onClick={props.onNewProject}>
          <span className="nav-icon"><Plus size={15} /></span>
          <span className="nav-name">Новое пространство</span>
        </button>
        {props.projects.length > 0 && (
          <label className="proj-search" data-tip="Найти пространство и перейти" data-key="⌘P">
            <Search size={13} />
            <input ref={search} placeholder="Найти пространство" value={query} spellCheck={false}
              onChange={(e) => (setQuery(e.target.value), setHi(0))}
              onBlur={() => setHi(0)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(h + 1, found.length - 1)));
                else if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
                else if (e.key === "Enter") (e.preventDefault(), jump(found[hi]));
                else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), setQuery(""), e.currentTarget.blur());
              }} />
            {query ? (
              <button className="proj-search-x" aria-label="Очистить" onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery("")}><X size={12} /></button>
            ) : <kbd>⌘P</kbd>}
          </label>
        )}
        <div className="proj-list">
          {found.map((p, i) => item(`p:${p.id}`, p.name, p.color, p.icon, () => props.onEditProject(p), undefined, query && i === hi ? "hi" : "", true))}
          {query && !found.length && <div className="proj-none">Ничего не нашлось</div>}
        </div>
      </>)}

      <div className="side-div" role="separator" />
      <div className="sec-row">
        <button className="sec-toggle" aria-expanded={!tagsFolded} onClick={() => props.onSetting(KEY_TAGS_COLLAPSED, tagsFolded ? "0" : "1")}
          data-tip={tagsFolded ? "Показать теги" : "Свернуть теги"}>
          <ChevronDown size={13} className={`chev ${tagsFolded ? "folded" : ""}`} />
          <span>Теги</span>
          {tagsFolded && props.tags.length > 0 && <span className="sec-n">{props.tags.length}</span>}
        </button>
      </div>
      {!tagsFolded && (
        <div className="proj-list tag-list">
          {props.tags.map((t) => {
            const id: ViewId = `t:${t.id}`;
            return (
              <div key={t.id} className={`nav tagnav ${cur === id ? "on" : ""}`} role="button" onClick={() => props.onOpen(id)}
                style={{ "--c": `var(--${t.color})` } as React.CSSProperties}>
                <button className="nav-icon" data-tip="Изменить тег" onClick={(e) => (e.stopPropagation(), setTagEdit({ id: t.id, el: e.currentTarget }))}>
                  <i className="tdot" />
                </button>
                <span className="nav-name">{t.name}</span>
                <span className="n">{countFor(id, props.tasks) || ""}</span>
              </div>
            );
          })}
          {!props.tags.length && <div className="side-hint">Появятся здесь, когда поставишь тег задаче. Можно прямо в названии: #созвон</div>}
        </div>
      )}
      {editing && tagEdit && (
        <TagEditor key={editing.id} tag={editing} anchor={tagEdit.el} onClose={() => setTagEdit(null)}
          onSave={(p) => props.onTagSave(editing.id, p)} onDelete={() => (setTagEdit(null), props.onTagDelete(editing.id))} />
      )}

      <ProfileSwitch />
      <div className="side-foot">
        <ThemeSwitch />
        <span className="side-foot-r">
          <button className="gear" data-tip="Сочетания клавиш" data-key="⌘/" aria-label="Сочетания клавиш" onClick={props.onShortcuts}><Keyboard size={16} /></button>
          <button className="gear" data-tip="Настройки" data-key="⌘," aria-label="Настройки" onClick={props.onSettings}><Gear size={15} /></button>
        </span>
      </div>
      {picker && pickerView && (
        <Popover anchor={picker.el} onClose={() => setPicker(null)} width={232}>
          <div className="lbl">Иконка для «{pickerView.name}»</div>
          <IconGrid value={viewIcon(picker.id, props.settings)} accent={pickerView.accent}
            onPick={(icon) => (props.onViewIcon(picker.id, icon), setPicker(null))} />
        </Popover>
      )}
    </nav>
  );
}

/** Активный профиль внизу меню, чтобы не перепутать, где ты. Клик открывает выбор профиля */
function ProfileSwitch() {
  const cur = activeProfile();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button className="side-profile" data-tip="Профиль: своя база задач и свои настройки" onClick={(e) => setAnchor(e.currentTarget)}>
        <span className="side-profile-dot" />
        <span className="nav-name">{profileName(cur)}</span>
        <ChevronsUpDown size={13} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={250}>
          <div className="lbl">Профиль</div>
          {PROFILES.map((p) => (
            <button key={p.id} className="profile-opt" data-profile={p.id} onClick={() => (setAnchor(null), switchProfile(p.id))}>
              <span className="side-profile-dot" />
              <span className="profile-opt-text"><b>{p.name}</b><span>{p.hint}</span></span>
              {p.id === cur && <Check size={14} />}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}
