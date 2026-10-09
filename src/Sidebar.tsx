import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Keyboard, LayoutGrid, Plus, Search, Settings as Gear, X } from "lucide-react";
import type { Project, Task } from "./db";
import { countFor, VIEWS, type ViewId } from "./views";
import { Icon } from "./icons";
import { IconGrid, Popover, ThemeSwitch } from "./widgets";
import { HomeIcon } from "./home/Home";

export const KEY_PROJECTS_COLLAPSED = "side.projects.collapsed";
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

export function matchProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  if (!q) return projects;
  const alt = swapLayout(q);
  const score = (p: Project) => {
    const n = p.name.toLowerCase();
    if (n.startsWith(q) || n.startsWith(alt)) return 0;
    if (n.includes(q) || n.includes(alt)) return 1;
    const d = p.description.toLowerCase();
    return d.includes(q) || d.includes(alt) ? 2 : -1;
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
  settings: Record<string, string>;
  onOpen: (v: ViewId) => void;
  onNewProject: () => void;
  onEditProject: (p: Project) => void;
  onViewIcon: (id: ViewId, icon: string) => void;
  onSetting: (key: string, value: string) => void;
  onSettings: () => void;
  onShortcuts: () => void;
}) {
  // Пункт меню, у которого сейчас открыт выбор иконки
  const [picker, setPicker] = useState<{ id: ViewId; el: HTMLElement } | null>(null);
  const [collapsed, setCollapsed] = useState(props.settings[KEY_PROJECTS_COLLAPSED] === "1");
  useEffect(() => setCollapsed(props.settings[KEY_PROJECTS_COLLAPSED] === "1"), [props.settings[KEY_PROJECTS_COLLAPSED]]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const item = (id: ViewId, label: string, accent: string, icon: string, onIcon: (el: HTMLElement) => void, key?: string, extra = "") => {
    const n = countFor(id, props.tasks);
    return (
      <div key={id} className={`nav ${props.view === id ? "on" : ""} ${extra}`} onClick={() => props.onOpen(id)} role="button"
        data-tip={key ? label : undefined} data-key={key}>
        <button className="nav-icon" data-tip="Сменить иконку" style={{ color: `var(--${accent})` }}
          onClick={(e) => (e.stopPropagation(), onIcon(e.currentTarget))}>
          <Icon name={icon} size={15} />
        </button>
        <span className="nav-name">{label}</span>
        <span className="n">{n || ""}</span>
      </div>
    );
  };
  const pickerView = picker && VIEWS.find((v) => v.id === picker.id);
  const visibleViews = VIEWS.map((v, i) => ({ v, key: `⌘${i + 1}` })).filter(({ v }) => v.id === "inbox" || props.settings[`hidden:${v.id}`] !== "1");

  return (
    <nav className="side">
      <div className={`nav ${props.view === "home" ? "on" : ""}`} onClick={() => props.onOpen("home")} role="button"
        data-tip="Главная" data-key="⌘0">
        <span className="nav-icon"><HomeIcon /></span>
        <span className="nav-name">Главная</span>
      </div>
      {visibleViews.map(({ v, key }) => item(v.id, v.name, v.accent, viewIcon(v.id, props.settings), (el) => setPicker({ id: v.id, el }), key))}

      <div className="side-div" role="separator" />

      <div className="sec-row">
        <button className="sec-toggle" aria-expanded={!collapsed} onClick={() => setFolded(!collapsed)}
          data-tip={collapsed ? "Показать проекты" : "Свернуть проекты"}>
          <ChevronDown size={13} className={`chev ${collapsed ? "folded" : ""}`} />
          <span>Проекты</span>
          {collapsed && props.projects.length > 0 && <span className="sec-n">{props.projects.length}</span>}
        </button>
        <button className={`sec-btn ${props.view === "projects" ? "on" : ""}`} onClick={() => props.onOpen("projects")}
          data-tip="Все проекты карточками" data-key="⌘6" aria-label="Все проекты">
          <LayoutGrid size={14} />
        </button>
      </div>

      {!collapsed && (<>
        <button className="nav add-project" onClick={props.onNewProject}>
          <span className="nav-icon"><Plus size={15} /></span>
          <span className="nav-name">Новый проект</span>
        </button>
        {props.projects.length > 0 && (
          <label className="proj-search" data-tip="Найти проект и перейти" data-key="⌘P">
            <Search size={13} />
            <input ref={search} placeholder="Найти проект" value={query} spellCheck={false}
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
          {found.map((p, i) => item(`p:${p.id}`, p.name, p.color, p.icon, () => props.onEditProject(p), undefined, query && i === hi ? "hi" : ""))}
          {query && !found.length && <div className="proj-none">Ничего не нашлось</div>}
        </div>
      </>)}

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
