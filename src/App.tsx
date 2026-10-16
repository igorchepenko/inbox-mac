import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { nextSpaceColor, spaceVars } from "./palette";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import * as db from "./db";
import type { Project, ProjectFields, Tag, Task } from "./db";
import { fmtDay, fmtRange, nowStamp, stampTime, today, toHHMM } from "./dates";
import { isWaiting, pingDue } from "./waiting";
import { ALWAYS, HOTKEY_VIEWS, inTasks, isSmart, listFor, plural, progressFor, revKey, revOf, scopeOf, sortOf, VIEWS, type SortBy, type ViewId } from "./views";
import { marks } from "./search";
import "./search.css";
import { Details, Help, QuickForm, Ring, type TaskPatch } from "./components";
import { Icon } from "./icons";
import { ProjectDialog } from "./widgets";
import PeoplePage from "./PeoplePage";
import { Assignee, PeopleCtx } from "./PersonCard";
import { Check, CheckCheck, Keyboard, Link2, ListChecks, Paperclip, Pencil, Repeat, Rows3, Tag as TagIcon, Users } from "lucide-react";
import { applyFilter, EMPTY_FILTER, filterOn, NO_SPACE, peopleOf, type TaskFilter } from "./tags";
import { FilterBar, FilterButton, FIND_EVENT, SearchField, TagChips, TagEditor, type SmartFilter } from "./TagsUI";
import { QuadrantGlyph } from "./extras";
import { CreatedMeta, DueFlag, MeetingMark, WaitingBadge } from "./TaskBits";
import { defaultBefore, remindPatch } from "./remind";
import { boardFor, canMove, CLOSING, dropTo, layoutOf, STAGES, stageOf, type Layout, type Stage } from "./boardOps";
import { SummaryDialog, type Closing } from "./Summary";
import { BoardView, BulkPanel, LayoutSwitch, SortSwitch, type Pick } from "./Board";
import { ensurePermission, fireDueReminders, maybeSendDigest, syncPlan } from "./reminders";
import { Settings } from "./Settings";
import { labelFromAccel, pref, quickKeyLabel, setQuickKeyLabel } from "./prefs";
import Home from "./home/Home";
import { KEY_HIDDEN, KEY_ORDER } from "./home/data";
import CalendarView from "./CalendarView";
import { PriorityIcon } from "./priority";
import { FIND_PROJECT_EVENT, Sidebar, viewIcon } from "./Sidebar";
import ProjectsPage from "./ProjectsPage";
import { Tooltips } from "./Tooltips";
import { ALL_SHOWN, shownFields, tips, type Shown } from "./fields";
import { QuickKeyBanner } from "./QuickKeyCheck";
import { usePanes } from "./panes";
import { Frame } from "./Frame";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  // Раздел «Люди»; personFocus — чью карточку открыть при переходе (с дня рождения в календаре)
  const [roster, setRoster] = useState<db.Person[]>([]);
  const [personFocus, setPersonFocus] = useState<string | null>(null);
  // День (ГГГГ-ММ-ДД), на который календарь переходит при открытии: клик по дню рождения в «Людях»
  const [calJump, setCalJump] = useState<string | null>(null);
  // Фильтры. Поиск, теги и «кто назначил» живут, пока открыт список, при переходе в другой сбрасываются.
  // Пространства остаются выбранными во всех списках и в календаре, пока их не сбросят
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER);
  const [tagEdit, setTagEdit] = useState<HTMLElement | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  // null закрыто, "new" новый проект, иначе редактируемый
  const [projectDlg, setProjectDlg] = useState<Project | "new" | null>(null);
  const [view, setView] = useState<ViewId>("home");
  // Несколько умных списков сразу (два и больше): вид при этом «Задачи», подборка хранится здесь
  const [multi, setMulti] = useState<ViewId[]>([]);
  const { panes, setWidth: setPaneWidth, toggle: togglePane, reset: resetPane } = usePanes();
  const [sel, setSel] = useState<number | null>(null);
  // Выделение для массовых действий и режим «Выбрать», в котором клик добавляет задачу к выделению
  const [picked, setPicked] = useState<number[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  // Окно итогов после перевода в «Готово» или «Отменено»
  const [closing, setClosing] = useState<Closing | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Раздел настроек, открытый сразу: кнопка «Поля» в шапке открывает «Поля задач»
  const [settingsTab, setSettingsTab] = useState<string | undefined>();
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const settingsRef = useRef<Record<string, string>>({});
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const reload = useCallback(async () => {
    try {
      await db.archiveOldDone();
      const [t, p, st, g, r] = await Promise.all([db.loadTasks(), db.loadProjects(), db.loadSettings(), db.loadTags(), db.loadPeopleList()]);
      setTasks(t);
      setRoster(r);
      setProjects(p);
      setTags(g);
      setSettings(st);
      settingsRef.current = st;
      setError(null);
      // Будущие напоминания сразу в расписание macOS: придут, даже если окно спрячут
      syncPlan(t, st);
      if (!started.current) {
        started.current = true;
        startUp(t, st);
      }
      return t;
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  // Действие с базой, затем перечитать всё. Задач у одного человека сотни, это мгновенно
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        setError(String(e));
      }
      await reload();
    },
    [reload],
  );

  useEffect(() => {
    reload();
    // Задачи из окна быстрого ввода и «Настройки…» из меню приложения
    const un = [listen("tasks-changed", () => reload()), listen("open-settings", () => setSettingsOpen(true))];
    // Раз в 30 секунд: напоминания, утренняя сводка, смена дня, архив вчерашних сделанных
    const id = setInterval(async () => {
      const t = await reload();
      const fired = await fireDueReminders(t, settingsRef.current);
      if ((await maybeSendDigest(t, settingsRef.current)) || fired) await reload();
      setTick((n) => n + 1);
    }, 30_000);
    return () => {
      clearInterval(id);
      un.forEach((p) => p.then((f) => f()));
    };
  }, [reload]);

  const layout = layoutOf(view, settings);
  const listFields = useMemo(() => shownFields(settings, "list"), [settings]);
  const sort = sortOf(view, settings);
  const rev = revOf(view, sort, settings);
  const people = useMemo(() => peopleOf(tasks, roster.map((r) => r.name)), [tasks, roster]);
  // Удалённый тег или пространство из фильтра выпадает само. Внутри пространства фильтр по пространствам не действует
  const inSpace = view.startsWith("p:");
  const filt = useMemo(() => ({
    ...filter,
    spaces: inSpace ? [] : filter.spaces.filter((id) => id === NO_SPACE || projects.some((p) => p.id === id)),
    tags: filter.tags.filter((id) => tags.some((g) => g.id === id)),
  }), [filter, tags, projects, inSpace]);
  const shown = useMemo(() => applyFilter(tasks, filt), [tasks, filt]);
  // В фильтре ровно одно пространство: новые задачи сразу записываются в него
  const oneSpace = filt.spaces.length === 1 && filt.spaces[0] !== NO_SPACE ? filt.spaces[0] : null;
  // Несколько умных списков: задачи, которые попадают хотя бы в один из них
  const inSmarts = useMemo(() => {
    if (view !== "tasks" || multi.length < 2) return shown;
    const ids = new Set(multi.flatMap((v) => listFor(v, shown).map((i) => i.task.id)));
    return shown.filter((x) => ids.has(x.id));
  }, [view, multi, shown]);
  const list = useMemo(() => listFor(view, inSmarts, sort, rev), [view, inSmarts, sort, rev]);
  const columns = useMemo(() => (layout === "board" ? boardFor(view, inSmarts, sort, rev) : null), [layout, view, inSmarts, sort, rev]);
  const ids = columns ? columns.flatMap((c) => c.items.map((i) => i.task.id)) : list.map((i) => i.task.id);
  const pickedTasks = tasks.filter((x) => picked.includes(x.id) && ids.includes(x.id));
  const bulk = selecting || pickedTasks.length > 1;
  const task = tasks.find((x) => x.id === sel && (view === "calendar" || ids.includes(x.id))) ?? null;

  // Когда выбранная задача ушла из списка (разобрана, сделана), выбираем ту, что встала на её место
  const lastIdx = useRef(0);
  useEffect(() => {
    if (view === "calendar") return; // в календаре выбор не зависит от списка
    if (sel == null) return; // ничего не выбрано: так и оставляем, пока не кликнут по задаче
    const i = ids.indexOf(sel ?? -1);
    if (i >= 0) lastIdx.current = i;
    else setSel(ids[Math.min(lastIdx.current, ids.length - 1)] ?? null);
  }, [ids.join(","), sel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Выбор задачи открывает правую панель: по умолчанию она свёрнута
  const select = (id: number | null) => {
    setSel(id);
    if (id != null) togglePane("det", false);
  };
  const clearPick = () => (setPicked([]), setSelecting(false));
  const openView = (v: ViewId) => {
    setView(v);
    setMulti([]);
    clearPick();
    setFilter((f) => ({ ...EMPTY_FILTER, spaces: f.spaces }));
    setTagEdit(null);
    lastIdx.current = 0;
    setSel(null);
    togglePane("det", true); // в списке, доске и календаре панель закрыта и ничего не выделено, пока не кликнешь по задаче
    db.setSetting("last.view", v).catch(() => {}); // для начального экрана «Где остановился»
  };

  const hidden = (v: ViewId) => !ALWAYS.includes(v) && settings[`hidden:${v}`] === "1";
  // Умный список в фильтрах «Задач»: тот же раздел, поиск и остальные фильтры остаются
  const smartOn: ViewId[] = isSmart(view) ? [view] : view === "tasks" ? multi : [];
  const setSmarts = (next: ViewId[]) => {
    // Один выбранный — это обычный умный список, два и больше — «Задачи» с подборкой
    const v = next.length === 1 ? next[0] : "tasks";
    setView(v);
    setMulti(next.length > 1 ? next : []);
    clearPick();
    lastIdx.current = 0;
    setSel(null);
    db.setSetting("last.view", v).catch(() => {});
  };
  const smart: SmartFilter | undefined = inTasks(view)
    ? { value: smartOn, onToggle: (v) => setSmarts(smartOn.includes(v) ? smartOn.filter((x) => x !== v) : [...smartOn, v]), onClear: () => setSmarts([]) }
    : undefined;
  const fieldsButton = (
    <button className="icon-btn" data-tip="Какие поля задачи видны: отдельно для списка, канбана и календаря"
      onClick={() => (setSettingsTab("fields"), setSettingsOpen(true))}>
      <Rows3 size={13} /> Поля
    </button>
  );

  // Сочетание быстрого ввода: Rust при запуске занимает ⌥Space, здесь меняем на сохранённое в настройках
  const applyShortcut = async (accel: string): Promise<string | null> => {
    try {
      await invoke("set_quick_shortcut", { accel, label: labelFromAccel(accel) });
      setQuickKeyLabel(accel);
      setShortcutError(null);
      return null;
    } catch (e) {
      return String(e);
    }
  };

  // Первая загрузка: начальный экран и сочетание из настроек
  function startUp(_t: Task[], st: Record<string, string>) {
    const start = pref(st, "start.view");
    const v = (start === "last" ? st["last.view"] ?? "inbox" : start) as ViewId;
    // Удалённый проект или спрятанный список сам сменится на «Новые»
    openView(v);
    const accel = pref(st, "quick.shortcut");
    // Сочетание у профиля своё, а занято оно одно на приложение: после смены профиля ставим сохранённое в нём.
    // Если не досталось ⌥Space, об этом уже говорит плашка из Rust
    applyShortcut(accel).then((err) => err && accel !== "Alt+Space" && setShortcutError(`Не удалось занять ${labelFromAccel(accel)}: ${err}`));
  }

  const patch = (id: number, p: TaskPatch) => {
    if (p.remind_at) ensurePermission();
    run(() => db.updateTask(id, p));
  };
  // Правка тега: ошибку (имя уже занято) показывает сама панель тега
  const saveTag = async (id: number, p: db.TagPatch): Promise<string | null> => {
    try {
      await db.updateTag(id, p);
      await reload();
      return null;
    } catch (e) {
      return String(e).replace(/^Error: /, "");
    }
  };
  const triage = (x: Task) => run(() => db.updateTask(x.id, { status: "active", triaged_at: nowStamp() }));
  // Перевод в этап из панели, канбана и по галочке. Через dropTo: completeTask и cancelTask создают следующий повтор,
  // reopenTask его убирает. «Готово» и «Отменено» закрывают задачу сразу, а потом спрашивают итоги
  const toStage = async (xs: Task[], stage: Stage) => {
    const moved = xs.filter((x) => stageOf(x) !== stage && canMove(x, stage));
    if (!moved.length) return;
    if (CLOSING.includes(stage)) setClosing({ ids: moved.map((x) => x.id), stage: stage as Closing["stage"] });
    // Канбан ждёт перечитанных задач, чтобы карточка села уже на новое место
    await run(async () => {
      for (const x of moved) await dropTo(x, stage);
    });
  };
  const toggleDone = (x: Task) => void (x.status === "done" ? run(() => db.reopenTask(x)) : toStage([x], "done"));
  const archive = (x: Task) => run(() => db.updateTask(x.id, { status: "archived", done_at: x.done_at ?? nowStamp() }));
  const restore = (x: Task) => run(() => db.updateTask(x.id, { status: "active", done_at: null, cancelled: 0 }));

  // С главной: отметка учитывает повторы, перенос просроченного сохраняет время напоминания
  const toggleFromHome = toggleDone;
  const moveToToday = (xs: Task[]) =>
    run(async () => {
      for (const x of xs) await db.updateTask(x.id, { due_date: today(), ...remindPatch(x, { due_date: today() }) });
    });
  // Задача с главной открывается в своём списке
  const homeOf = (x: Task): ViewId => {
    const t = today();
    return x.status === "inbox" ? "inbox" : x.status === "archived" ? "archive" : pingDue(x, t) ? "today" : isWaiting(x) ? "waiting"
      : x.due_date && x.due_date <= t ? "today" : x.status === "done" ? "today" : "soon";
  };
  const openTask = (x: Task) => {
    setView(homeOf(x));
    select(x.id);
  };
  // Стрелки из поля поиска двигают выбор в списке
  const stepSel = (dir: 1 | -1) => {
    const i = ids.indexOf(sel ?? -1);
    const next = ids[i < 0 ? 0 : i + dir];
    if (next != null) select(next);
  };
  const setText = (text: string) => setFilter((f) => ({ ...f, text }));
  // Клик выбирает задачу, ⌘-клик или режим «Выбрать» добавляют к выделению, ⇧-клик берёт всё подряд от выбранной
  const pick: Pick = (id, m) => {
    if (m.shift && sel != null && ids.includes(sel)) {
      const [a, b] = [ids.indexOf(sel), ids.indexOf(id)].sort((x, y) => x - y);
      setPicked(ids.slice(a, b + 1));
      return;
    }
    if (m.meta || selecting) {
      const base = picked.length ? picked : sel != null && sel !== id ? [sel] : [];
      setPicked(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
    } else setPicked([]);
    select(id);
  };
  const setLayout = (l: Layout) => {
    if (l !== layout) (setSel(null), togglePane("det", true)); // смена вида — тоже «переход»: панель закрыта, выделения нет
    run(() => db.setSetting(`layout:${scopeOf(view)}`, l));
  };
  const setSort = (s: SortBy) => {
    const key = `sort:${scopeOf(view)}`;
    setSettings((st) => ({ ...st, [key]: s }));
    run(() => db.setSetting(key, s));
  };
  // Направление помнится для каждой сортировки в каждом списке
  const reverseSort = () => {
    const key = revKey(view, sort), value = rev ? "0" : "1";
    setSettings((st) => ({ ...st, [key]: value }));
    run(() => db.setSetting(key, value));
  };
  const moveCards = (moved: number[], col: Stage) => toStage(tasks.filter((x) => moved.includes(x.id)), col);

  // Клик по пустому месту календаря: задача на этот день и время, название сразу выделено для правки.
  // Если в фильтре одно пространство, задача сразу в нём, иначе фильтр бы её спрятал
  const createAt = async (day: string, start: number | null, end: number | null) => {
    try {
      const id = await db.addTask("Новая задача", "", {
        project_id: oneSpace, due_date: day, start_time: start == null ? null : toHHMM(start), end_time: end == null ? null : toHHMM(end),
      });
      await reload();
      select(id);
      setTimeout(() => {
        const el = document.querySelector<HTMLTextAreaElement>(".det-title");
        el?.focus();
        el?.select();
      }, 50);
    } catch (e) {
      setError(String(e));
    }
  };

  // Пространство прямо из задачи: только название, цвет первый свободный, иконку и остальное можно поменять потом
  const createProject = async (name: string) => {
    const id = await db.addProject({ name, description: "", color: nextSpaceColor(projects.map((p) => p.color)), icon: "folder" }, projects.length + 1);
    await reload();
    return id;
  };

  const saveNew = (title: string, note: string, draft: db.Draft) => {
    setNewOpen(false);
    if (draft.remind_at) ensurePermission();
    (async () => {
      try {
        const id = await db.addTask(title, note, draft);
        const all = await reload();
        // Записанная сразу в «К выполнению» или «Готово» открывается там, где теперь лежит
        const x = all.find((t) => t.id === id);
        // Во «Всех задачах» новая и так видна, оттуда не уводим
        setView(x && draft.stage ? homeOf(x) : view === "tasks" ? "tasks" : "inbox");
        select(id);
      } catch (e) {
        setError(String(e));
      }
    })();
  };

  // Файлы из Finder: брошенные на строку прикрепляются к этой задаче, брошенные в другое место — к выбранной
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [dropOnDetails, setDropOnDetails] = useState(false);
  const live = useRef({ sel, tasks, busy: false });
  const lastRow = useRef<number | null>(null);
  live.current = { sel, tasks, busy: newOpen || !!projectDlg || helpOpen || !!closing };
  useEffect(() => {
    // Над панелью задачи зона горит всё время, пока там курсор: решает панель целиком, а не то, что под курсором внутри неё.
    // Между строками списка остаётся последняя строка, иначе подсветка моргала бы на каждом зазоре.
    const targetAt = (pos: { x: number; y: number }) => {
      // На macOS wry отдаёт точку в логических пикселях, хотя тип называется PhysicalPosition
      // (wry 0.57, wkwebview/drag_drop.rs). Деление на devicePixelRatio на Retina уводило точку в левую верхнюю четверть окна
      const k = /Mac/.test(navigator.userAgent) ? 1 : devicePixelRatio;
      const el = document.elementFromPoint(pos.x / k, pos.y / k);
      const onPanel = !!el?.closest(".det");
      const row = onPanel ? null : el?.closest<HTMLElement>("[data-task-id]");
      if (row) lastRow.current = Number(row.dataset.taskId);
      const inList = !onPanel && !!el?.closest(".views");
      const id = onPanel ? live.current.sel : row ? Number(row.dataset.taskId) : inList ? lastRow.current ?? live.current.sel : live.current.sel;
      const t = live.current.tasks.find((x) => x.id === id);
      return { id: t && t.status !== "archived" && !live.current.busy ? t.id : null, onRow: !onPanel && (!!row || (inList && lastRow.current != null)) };
    };
    const un = getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      if (p.type === "leave") return (lastRow.current = null), setDropTarget(null);
      if (p.type === "enter") lastRow.current = null;
      const { id, onRow } = targetAt(p.position);
      if (p.type === "drop") {
        setDropTarget(null);
        if (id != null && p.paths.length) {
          select(id);
          run(() => db.attachFiles(id, p.paths));
        }
        return;
      }
      setDropTarget(id);
      setDropOnDetails(!onRow);
    });
    return () => void un.then((f) => f());
  }, [run]);

  // Клавиатура
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.code === "Comma") return e.preventDefault(), setSettingsOpen(true);
      // Формы сами ловят Enter и Esc, пока фокус в них. Если фокус выпал из окна (клик по пустому месту),
      // Esc закрывает его отсюда; настройки и итоги закрываются сами
      if (newOpen || projectDlg || settingsOpen || closing) {
        if (e.key === "Escape" && !settingsOpen && !closing) (setNewOpen(false), setProjectDlg(null));
        return;
      }
      if (helpOpen) {
        if (e.key === "Escape" || (e.metaKey && e.code === "Slash")) setHelpOpen(false);
        return;
      }
      if (e.metaKey && e.code === "Slash") return e.preventDefault(), setHelpOpen(true);
      if (e.metaKey && e.ctrlKey && e.code === "KeyS") return e.preventDefault(), togglePane("side");
      if (e.metaKey && e.altKey && e.code === "KeyI") return e.preventDefault(), togglePane("det");
      if (e.metaKey && e.code === "Digit0") return e.preventDefault(), openView("home");
      if (e.metaKey && e.code === "Digit7") return e.preventDefault(), openView("projects");
      if (e.metaKey && e.code === "Digit8") return e.preventDefault(), openView("people");
      if (e.metaKey && e.code === "KeyP") return e.preventDefault(), window.dispatchEvent(new Event(FIND_PROJECT_EVENT));
      if (e.metaKey && e.code === "KeyF") return e.preventDefault(), window.dispatchEvent(new Event(FIND_EVENT));
      if (e.metaKey && /^Digit[1-6]$/.test(e.code)) {
        e.preventDefault();
        const v = HOTKEY_VIEWS[Number(e.code.slice(5)) - 1].id;
        if (!hidden(v)) openView(v);
        return;
      }
      const el = document.activeElement as HTMLElement | null;
      if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) {
        if (e.key === "Escape") el.blur();
        return;
      }
      if (e.metaKey && e.code === "KeyA") return e.preventDefault(), setPicked(ids);
      if (e.key === "Escape" && bulk) return clearPick();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const i = ids.indexOf(sel ?? -1);
      // e.code не зависит от раскладки: N работает и на русской
      switch (e.code) {
        case "KeyN":
          e.preventDefault();
          setNewOpen(true);
          break;
        case "ArrowDown":
        case "KeyJ":
          e.preventDefault();
          if (ids[i + 1] != null) select(ids[i + 1]);
          break;
        case "ArrowUp":
        case "KeyK":
          e.preventDefault();
          if (i > 0) select(ids[i - 1]);
          break;
        case "Enter":
          if (task?.status === "inbox") triage(task);
          break;
        case "Space":
          e.preventDefault();
          if (task && task.status !== "archived") toggleDone(task);
          break;
        case "Digit1":
        case "Digit2":
        case "Digit3":
        case "Digit4":
        case "Digit5":
          if (task && task.status !== "archived") patch(task.id, { priority: Number(e.code.slice(5)) });
          break;
        case "KeyT":
          if (task && task.status !== "archived") patch(task.id, { due_date: today(), ...remindPatch(task, { due_date: today() }) });
          break;
        case "Escape":
          // Esc снимает выделение и закрывает правую панель, как переход в другой раздел
          (document.activeElement as HTMLElement | null)?.blur();
          if (sel != null || !panes.det.collapsed) (setSel(null), togglePane("det", true));
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Главная и страница проектов занимают всё место справа от меню, без панели деталей
  const wide = view === "home" || view === "projects" || view === "people";
  const current = VIEWS.find((v) => v.id === view);
  const project = view.startsWith("p:") ? projects.find((p) => `p:${p.id}` === view) : undefined;
  const tag = view.startsWith("t:") ? tags.find((g) => `t:${g.id}` === view) : undefined;
  // Удалённый тег тоже уводит в «Новые». Пока база не прочитана, тегов ещё нет, поэтому ждём первой загрузки
  const lostTag = view.startsWith("t:") && !tag && started.current;
  if (!wide && ((!current && !project && !tag && (projects.length || lostTag)) || hidden(view))) queueMicrotask(() => openView("inbox"));
  const progress = progressFor(view, tasks);

  return (
    <PeopleCtx.Provider value={roster}>
    <div className={`app ${view === "home" ? "app-home" : view === "projects" || view === "people" ? "app-wide" : ""} ${panes.side.collapsed ? "side-off" : ""} ${panes.det.collapsed && !wide ? "det-off" : ""}`}
      style={{ "--side-w": `${panes.side.collapsed ? 0 : panes.side.width}px`, "--det-w": `${panes.det.collapsed ? 0 : panes.det.width}px` } as CSSProperties}>
      <div className="titlebar" data-tauri-drag-region />
      <Frame panes={panes} hasDetails={!wide} onWidth={setPaneWidth} onToggle={togglePane} onReset={resetPane} />
      <Sidebar view={view} tasks={tasks} projects={projects} tags={tags} peopleCount={roster.length} settings={settings} onOpen={openView}
        onTagSave={saveTag} onTagDelete={(id) => run(() => db.deleteTag(id))}
        onNewProject={() => setProjectDlg("new")} onEditProject={(p) => setProjectDlg(p)}
        onSettings={() => setSettingsOpen(true)} onShortcuts={() => setHelpOpen(true)}
        onSetting={(key, value) => {
          setSettings((st) => ({ ...st, [key]: value }));
          run(() => db.setSetting(key, value));
        }}
        onViewIcon={(id, icon) => run(() => db.setSetting(`icon:${id}`, icon))} />

      {view === "calendar" ? (
        <CalendarView tasks={shown} projects={projects} selected={sel} onSelect={select}
          filterButton={<>
            <SearchField value={filter.text} onChange={setText} placeholder="Найти в календаре" tip="Поиск по задачам в календаре" />
            <FilterButton filter={filt} projects={projects} tags={tags} people={people} onChange={setFilter} />
            {fieldsButton}
          </>}
          filterBar={<FilterBar filter={filt} projects={projects} tags={tags} onChange={setFilter} />}
          onToggle={toggleDone}
          onMove={(id, p) => {
            if (p.remind_at) ensurePermission();
            run(() => db.updateTask(id, p));
          }}
          onCreate={createAt} show={shownFields(settings, "calendar")}
          birthdays={roster} onOpenPerson={(name) => (setPersonFocus(name), openView("people"))}
          jump={calJump} onJumped={() => setCalJump(null)} />
      ) : (
      <main className={`main ${project ? "in-space" : ""}`} style={spaceVars(project?.color)}>
        {view === "people" ? (
          <PeoplePage people={roster} tasks={tasks} tags={tags} reload={reload} focus={personFocus} onFocused={() => setPersonFocus(null)}
            onOpenBirthday={(day) => (openView("calendar"), setCalJump(day))}
            onOpenTasks={(name, kind) => (openView("tasks"), setFilter((f) => ({ ...f, ...(kind === "by" ? { person: name } : { waiting: name }) })))} />
        ) : view === "projects" ? (
          <ProjectsPage projects={projects} tasks={tasks} onOpen={openView}
            onEdit={(p) => setProjectDlg(p)} onNew={() => setProjectDlg("new")} />
        ) : view === "home" ? (
          <Home tasks={tasks} projects={projects} settings={settings}
            onOpenInbox={() => openView("inbox")} onOpenToday={() => openView("today")}
            onOpenTask={openTask} onToggle={toggleFromHome} onMoveToToday={moveToToday}
            onNewProject={() => setProjectDlg("new")}
            onSaveLayout={(order, hidden) => {
              setSettings((s) => ({ ...s, [KEY_ORDER]: JSON.stringify(order), [KEY_HIDDEN]: JSON.stringify(hidden) }));
              run(async () => {
                await db.setSetting(KEY_ORDER, JSON.stringify(order));
                await db.setSetting(KEY_HIDDEN, JSON.stringify(hidden));
              });
            }} />
        ) : (<>
        <header className="head" data-tauri-drag-region>
          {progress ? <Ring fraction={progress.fraction} accent={progress.accent} count={progress.count} /> : tag ? (
            <span className="head-icon" style={{ color: `var(--${tag.color})` }}><TagIcon size={22} /></span>
          ) : (
            <span className="head-icon" style={{ color: `var(--${project?.color ?? current?.accent ?? "muted"})` }}>
              <Icon name={project?.icon ?? viewIcon(current?.id ?? "inbox", settings)} size={24} />
            </span>
          )}
          <div className="head-text">
            <h2>{project?.name ?? tag?.name ?? (inTasks(view) ? "Задачи" : current?.name) ?? ""}</h2>
            <p className="head-sub" data-tip={project?.description || undefined} data-tip-full="">{project?.description || progress?.subtitle || subtitleFor(view, list.length)}</p>
          </div>
          <div className="head-tools">
            {project && (
              <button className="icon-btn" data-tip="Изменить пространство" onClick={() => setProjectDlg(project)}>
                <Pencil size={13} /> Изменить
              </button>
            )}
            {tag && (
              <button className="icon-btn" data-tip="Переименовать, сменить цвет, удалить" onClick={(e) => setTagEdit(tagEdit ? null : e.currentTarget)}>
                <Pencil size={13} /> Изменить
              </button>
            )}
            <SearchField value={filter.text} onChange={setText} onArrow={stepSel} placeholder="Найти задачу"
              tip="Поиск по задачам на этом экране: название, заметка, чеклист, теги, люди, ссылки" />
            {view !== "archive" && <SortSwitch value={sort} rev={rev} onChange={setSort} onReverse={reverseSort} />}
            <FilterButton filter={filt} projects={projects} tags={tags} people={people} lockTag={tag?.id} noSpaces={!!project} onChange={setFilter} smart={smart} />
            {fieldsButton}
            <LayoutSwitch value={layout} onChange={setLayout} />
            <button className={`icon-btn ${selecting ? "on" : ""}`} data-tip="Выбрать несколько задач, ⌘-клик по строке" data-key="⌘A"
              onClick={() => (selecting ? clearPick() : (setSelecting(true), setPicked(sel != null ? [sel] : [])))}>
              <CheckCheck size={13} /> Выбрать
            </button>
            <button className="icon-btn" data-tip="Сочетания клавиш" data-key="⌘/" aria-label="Сочетания клавиш" onClick={() => setHelpOpen(true)}><Keyboard size={14} /></button>
          </div>
        </header>

        <FilterBar filter={filt} projects={projects} tags={tags} shown={ids.length} onChange={setFilter} smart={smart} />

        {view !== "archive" && (
          <button className="add field" onClick={() => setNewOpen(true)}>
            + Записать задачу <kbd>N</kbd>
          </button>
        )}

        {error && <div className="error">Ошибка базы: {error}</div>}

        <div className={`views ${selecting ? "selecting" : ""}`}>
          {columns ? (
            <BoardView columns={columns} projects={projects} sel={sel} picked={picked}
              fileDrop={dropOnDetails ? null : dropTarget} query={filt.text}
              onPick={pick} onToggle={toggleDone} onMove={moveCards} show={shownFields(settings, "board")} />
          ) : (
            <div className="list" role="listbox">
              {list.map(({ task: x, group }) => (
                <div key={x.id}>
                  {group && <div className="group">{group}</div>}
                  <TaskRow task={x} project={projects.find((p) => p.id === x.project_id)} selected={x.id === sel} query={filt.text}
                    picked={picked.includes(x.id)} dropping={dropTarget === x.id && !dropOnDetails} onSelect={(m) => pick(x.id, m)} onToggle={() => toggleDone(x)}
                    show={listFields} />
                </div>
              ))}
              {!list.length && <div className="empty">{filt.text.trim() ? "Ничего не нашлось. Ищу в названии, заметке, чеклисте, тегах, по людям, пространству и ссылкам." : filterOn(filt) ? "С такими фильтрами задач нет." : emptyText(view)}</div>}
            </div>
          )}
        </div>
        </>)}
      </main>
      )}

      {wide ? null : bulk ? (
        <BulkPanel tasks={pickedTasks} total={ids.length} projects={projects} selecting={selecting} run={run}
          onSelectAll={() => setPicked(ids)} onClear={clearPick} />
      ) : task ? (
        <Details key={task.id} task={task} projects={projects} tags={tags} people={people} remindBefore={defaultBefore(settings)}
          onPatch={(p) => patch(task.id, p)} onCreateProject={createProject} run={run} onError={setError}
          dropping={dropTarget === task.id && dropOnDetails}
          onTriage={() => triage(task)} onToggleDone={() => toggleDone(task)} onStage={(st) => toStage([task], st)}
          onArchive={() => archive(task)} onRestore={() => restore(task)}
          onDelete={() => run(() => db.deleteTask(task.id))} />
      ) : (
        <aside className="det"><div className="hint">Выбери задачу, чтобы увидеть детали.</div></aside>
      )}

      {newOpen && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setNewOpen(false)}>
          <QuickForm projects={projects} tags={tags} people={people} remindBefore={defaultBefore(settings)} onSave={saveNew} onCancel={() => setNewOpen(false)} closable onCreateProject={createProject}
            initial={project ? { project_id: project.id } : oneSpace != null ? { project_id: oneSpace } : undefined} />
        </div>
      )}
      {tag && tagEdit && (
        <TagEditor key={tag.id} tag={tag} anchor={tagEdit} onClose={() => setTagEdit(null)}
          onSave={(p) => saveTag(tag.id, p)} onDelete={() => (setTagEdit(null), run(() => db.deleteTag(tag.id)))} />
      )}
      {helpOpen && <Help onClose={() => setHelpOpen(false)} />}
      {closing && (
        <SummaryDialog key={`sum:${closing.ids.join(",")}`} closing={closing} tasks={tasks.filter((x) => closing.ids.includes(x.id))}
          onSkip={() => setClosing(null)}
          onSave={(text) => {
            const ids = closing.ids;
            setClosing(null);
            run(async () => {
              for (const id of ids) await db.setSummary(id, text);
            });
          }} />
      )}
      <Tooltips />
      {!settingsOpen && <QuickKeyBanner error={shortcutError} onSettings={() => setSettingsOpen(true)} />}
      {settingsOpen && (
        <Settings settings={settings} shortcutError={shortcutError} initial={settingsTab} onClose={() => (setSettingsOpen(false), setSettingsTab(undefined))} onData={reload}
          onSet={(key, value) => run(() => db.setSetting(key, value))}
          onQuickShortcut={async (accel) => {
            const err = await applyShortcut(accel);
            if (!err) await run(() => db.setSetting("quick.shortcut", accel));
            return err;
          }} />
      )}
      {projectDlg && (
        <ProjectDialog
          initial={projectDlg === "new" ? undefined : projectDlg}
          onClose={() => setProjectDlg(null)}
          onSave={(fields: ProjectFields) => {
            const target = projectDlg;
            setProjectDlg(null);
            run(() => (target === "new" ? db.addProject(fields, projects.length + 1) : db.updateProject(target.id, fields)));
          }}
          taskCount={projectDlg === "new" ? 0 : tasks.filter((x) => x.project_id === projectDlg.id).length}
          others={projects.filter((p) => projectDlg === "new" || p.id !== projectDlg.id)}
          onDelete={projectDlg === "new" ? undefined : (fate) => {
            const id = projectDlg.id;
            setProjectDlg(null);
            if (view === `p:${id}`) openView("projects");
            run(() => db.deleteProject(id, fate));
          }}
        />
      )}
    </div>
    </PeopleCtx.Provider>
  );
}

function subtitleFor(view: ViewId, n: number): string {
  if (view === "archive") return n ? `${plural(n, "задача сделана или отменена", "задачи сделаны или отменены", "задач сделаны или отменены")}` : "";
  if (view === "tasks") return n ? `Все задачи, кроме завершённых: ${n}` : "";
  if (view === "waiting") return n ? "Задачи, которые ждут ответа или результата от других людей" : "";
  if (view === "soon") return n ? "Запланированное на будущее и разобранное без даты" : "";
  return n ? `${n} в работе` : "";
}

function emptyText(view: ViewId): string {
  if (view === "inbox") return `Здесь пусто. Нажми ${quickKeyLabel()} в любом приложении, чтобы записать задачу.`;
  if (view === "waiting") return "Никого не ждёшь. В панели задачи поле «Жду» ставит задачу сюда.";
  if (view === "today") return "На сегодня ничего. Поставь дату «Сегодня» при разборе.";
  if (view === "archive") return "Сделанные и отменённые задачи попадают сюда на следующий день.";
  if (view === "tasks") return `Задач пока нет. Нажми ${quickKeyLabel()} в любом приложении, чтобы записать задачу.`;
  return "Здесь пока ничего нет.";
}

function TaskRow(props: {
  task: Task;
  project?: Project;
  selected: boolean;
  picked: boolean;
  dropping?: boolean;
  onSelect: (mods: { meta: boolean; shift: boolean }) => void;
  onToggle: () => void;
  query?: string; // подсветить найденное поиском в названии
  show?: Shown; // какие поля видны, Настройки → «Поля задач»
}) {
  const { task: x, project } = props;
  const show = props.show ?? ALL_SHOWN;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [props.selected]);
  const done = x.status === "done" || x.status === "archived";
  const cancelled = done && !!x.cancelled;
  const overdue = x.status === "active" && !!x.due_date && x.due_date < today();
  return (
    <div ref={ref} role="option" aria-selected={props.selected} data-task-id={x.id}
      className={`row ${x.kind === "meeting" ? "meeting" : ""} ${props.selected ? "sel" : ""} ${props.picked ? "picked" : ""} ${done ? "done" : ""} ${cancelled ? "cancelled" : ""} ${props.dropping ? "drop" : ""} ${project ? "pc" : ""}`}
      style={spaceVars(project?.color)}
      onMouseDown={(e) => props.onSelect({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })}>
      <button className="chk" title={done ? "Вернуть в работу" : "Сделано"} disabled={x.status === "archived"}
        onMouseDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), props.onToggle())}>
        {done && !cancelled && <Check size={11} strokeWidth={3.2} />}
      </button>
      {show("kind") && <MeetingMark task={x} />}
      {/* Обрезанное название целиком в подсказке, сразу при наведении */}
      <span className="t" data-tip={x.title} data-tip-full="">
        {props.query ? marks(x.title, props.query).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part)) : x.title}
      </span>
      {show("tags") && <TagChips tags={x.tags} max={2} />}
      <WaitingBadge task={x} />
      {show("assignee") && x.assigned_by && <Assignee name={x.assigned_by} />}
      {show("participants") && x.participants.length > 0 && (
        <span className="meta badge" data-tip={tips.participants(x.participants)}><Users size={12} /> {x.participants.length}</span>
      )}
      {show("checklist") && x.subtasks.length > 0 && (
        <span className="meta badge" data-tip={tips.checklist(x)}><ListChecks size={12} /> {x.subtasks.filter((s) => s.done).length}/{x.subtasks.length}</span>
      )}
      {show("links") && x.links.length > 0 && <span className="meta badge" data-tip={tips.links(x)}><Link2 size={12} />{x.links.length > 1 ? ` ${x.links.length}` : ""}</span>}
      {show("files") && x.files.length > 0 && <span className="meta badge" data-tip={tips.files(x)}><Paperclip size={12} />{x.files.length > 1 ? ` ${x.files.length}` : ""}</span>}
      {show("repeat") && x.recurrence && !done && <span className="meta badge" data-tip={tips.repeat(x)}><Repeat size={12} /></span>}
      {show("matrix") && x.quadrant && !done && <span className="tipped" data-tip={tips.matrix(x.quadrant)}><QuadrantGlyph q={x.quadrant} /></span>}
      {show("time") && x.start_time && <span className="meta" data-tip={tips.time(x)}>{fmtRange(x.start_time, x.end_time)}</span>}
      {show("due") && <DueFlag task={x} />}
      {show("remind") && x.remind_at && !x.reminded && !done && <span className="meta" data-tip={tips.remind(x)}>⏰ {stampTime(x.remind_at)}</span>}
      {show("priority") && x.priority > 0 && !done && <span className="tipped" data-tip={tips.priority(x.priority)}><PriorityIcon p={x.priority} /></span>}
      {show("stage") && (x.status !== "archived" || cancelled) && <StageChip task={x} />}
      {show("space") && project && <span className="tag" data-tip={tips.space(project.name)} style={{ background: `var(--${project.color})`, color: `var(--${project.color}-ink, var(--on-acc))` }}>{project.name}</span>}
      {show("date") && x.due_date && <span className={`meta ${overdue ? "overdue" : ""}`} data-tip={tips.date(x, overdue)}>{fmtDay(x.due_date)}</span>}
      {show("created") && <CreatedMeta task={x} />}
    </div>
  );
}

/** Этап задачи в строке, как столбец канбана: Новые, К выполнению, Готово, Отменено. В «Завершённых» виден только «Отменено» */
function StageChip({ task }: { task: Task }) {
  const st = STAGES.find((s) => s.key === stageOf(task))!;
  return (
    <span className="stage" data-tip={tips.stage(task)} style={{ "--c": `var(--${st.accent})` } as React.CSSProperties}>
      <Icon name={st.icon} size={11} /> {st.name}
    </span>
  );
}
