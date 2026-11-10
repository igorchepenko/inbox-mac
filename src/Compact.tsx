import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ArrowUp, Check, Search, Settings as Gear, X } from "lucide-react";
import { addTask, completeTask, reopenTask, loadProjects, updateSubtask, loadSettings, loadTasks, loadPeopleList, type Person, type Project, type Task } from "./db";
import { Icon } from "./icons";
import { Tooltips } from "./Tooltips";
import { compactItems, compactSearch, compactTabs, rowShown, zoomOf, listAccent, listIcon, listName, savedList, saveList } from "./compactLists";
import { countFor, type ViewId } from "./views";
import { isBlocked } from "./relations";
import { marks } from "./search";
import { clampRow, keyAction, stepList, stepRow } from "./compactKeys";
import { loadCompactPrefs, onCompactPrefs, type EdgeSide } from "./compactPrefs";
import { currentZoom } from "./prefs";
import TaskCard, { type CardAnchor } from "./CompactCard";
import CompactSettings from "./CompactSettings";
import { PeopleCtx } from "./PersonCard";
import { RowMark, RowMeta } from "./CompactRow";
import "./compact.css";

/*
 * Окно компактного вида: открывается от значка у правого края экрана (src-tauri/src/compact.rs).
 * Сверху переключатель списков иконками, в строке задачи название и параметры; наведение подсвечивает строку,
 * клик (или Enter на выбранной с клавиатуры) открывает карточку со всем, что есть у задачи (CompactCard.tsx),
 * внизу строка ввода: Enter записывает задачу в «Новые» с одним названием.
 * С клавиатуры (окно открыли сочетанием): ↑ и ↓ по задачам, ← и → по спискам (compactKeys.ts)
 */

const hold = (on: boolean) => invoke("compact_hold", { on }).catch(() => {});

/** Ручки по краям окна: тянешь — окно меняет размер. Край со стороны значка прижат к нему, там ручек нет */
const HANDLES: Record<EdgeSide, string[]> = { right: ["n", "s", "w", "nw", "sw"], left: ["n", "s", "e", "ne", "se"] };

export default function CompactApp() {
  const [view, setView] = useState<ViewId>(savedList);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [setup, setSetup] = useState(false); // страница настроек вместо списка
  const [card, setCard] = useState<CardAnchor | null>(null); // открытая карточка задачи
  const [people, setPeople] = useState<Person[]>([]);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [undo, setUndo] = useState<Task | null>(null); // только что отмеченная сделанной: можно вернуть
  const [find, setFind] = useState<string | null>(null); // null — поиск закрыт, строка — открыт с запросом
  const [findFocus, setFindFocus] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);
  const findOpen = useRef(false);
  findOpen.current = find !== null;
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<EdgeSide>("right");
  // Строка под клавиатурным курсором, null — курсора нет (окно открыли мышью)
  const [cur, setCur] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const cardOpen = useRef(false);
  cardOpen.current = !!card;
  
  const reload = () =>
    Promise.all([loadTasks(), loadSettings(), loadProjects(), loadPeopleList()])
      .then(([t, st, p, r]) => (setTasks(t), setSettings(st), setProjects(p), setPeople(r), setError(null)))
      .catch((e) => setError(String(e)));

  useEffect(() => {
    reload();
    loadCompactPrefs().then((p) => setSide(p.side));
    const un = [
      onCompactPrefs((p) => setSide(p.side)),
      // Открыли сочетанием: курсор на первой задаче, клавиатура у списка, а не у строки ввода
      listen<boolean>("compact-open", (e) => (reload(), setCur(e.payload ? 0 : null), e.payload && input.current?.blur())),
      listen("tasks-changed", () => reload()),
      // Окно спряталось: карточку убираем, фокус из строки ввода снимаем, набранный текст остаётся
      listen("compact-hidden", () => (setCard(null), setCur(null), input.current?.blur())),
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      // Открытая карточка закрывается первой; окно остаётся
      if (cardOpen.current) return setCard(null);
      // Следующий Esc закрывает поиск или уводит фокус из строки ввода, потом закрывает окно
      if (findOpen.current) setFind(null);
      else if (document.activeElement === input.current) input.current?.blur();
      else invoke("compact_hide").catch(() => {});
    };
    addEventListener("keydown", onKey);
    return () => (removeEventListener("keydown", onKey), un.forEach((p) => p.then((f) => f())));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Пока пишешь задачу, окно не закрывается от ухода курсора
  useEffect(() => void hold(focused || text.trim() !== "" || findFocus || !!find?.trim() || !!card), [focused, text, findFocus, find, card]);

  // Масштаб компактного окна: поверх размера из внешнего вида. --z нужен, чтобы прозрачный отступ под ручки оставался 10 px (PAD в compact.rs)
  const zoom = zoomOf(settings);
  const applyZoom = () => {
    const z = currentZoom() * zoom;
    document.documentElement.style.setProperty("--z", String(z));
    getCurrentWebview().setZoom(z).catch(() => {});
  };
  useEffect(applyZoom, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Внешний вид главного окна мог сбросить масштаб: при каждом показе окна ставим свой
    const un = listen("compact-open", () => window.setTimeout(applyZoom, 50));
    return () => void un.then((f) => f());
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (v: ViewId) => (setView(v), saveList(v), setCard(null), setSetup(false), setFind(null), setCur((c) => (c == null ? null : 0)));
  const toggleFind = () => {
    setSetup(false);
    setCard(null);
    if (find !== null) return setFind(null);
    setFind("");
    window.setTimeout(() => findRef.current?.focus(), 0);
  };

  const save = async () => {
    const title = text.trim();
    if (!title) return;
    try {
      await addTask(title, "");
      setText("");
      setNote("Записано в «Новые»");
      window.setTimeout(() => setNote(null), 2200);
      await emit("tasks-changed");
    } catch (e) {
      setError(String(e));
    }
  };

  const searching = find !== null && !setup;
  const items = searching ? compactSearch(find, tasks, settings) : compactItems(view, tasks, settings);
  const tabs = compactTabs(settings, tasks, view);

  // Клавиатура: обработчик один, свежие список и курсор берёт из ref
  const kb = useRef({ items, cur, view, tabs, setup });
  kb.current = { items, cur: clampRow(cur, items.length), view, tabs, setup };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const { items: xs, cur: c, view: v, tabs: ts, setup: inSetup } = kb.current;
      if (inSetup || cardOpen.current) return;
      const inAdd = document.activeElement === input.current;
      const inFind = document.activeElement === findRef.current;
      // Из строки поиска ↓ уходит к списку, остальные клавиши остаются полю
      const act = inFind && e.key === "ArrowDown" ? "down" : keyAction(e, inAdd || inFind);
      const inInput = inAdd || inFind;
      if (!act) return;
      // Без курсора Enter остаётся кнопке в фокусе
      if (act === "enter" && (c == null || !xs[c])) return;
      e.preventDefault();
      if (act === "up" || act === "down") {
        // ↓ с последней задачи уходит в строку ввода, ↑ из неё возвращает к последней задаче
        if (act === "down" && c != null && c === xs.length - 1) return (setCur(null), input.current?.focus());
        if (inInput) (inAdd ? input.current : findRef.current)?.blur();
        setCur(stepRow(c, act === "down" ? 1 : -1, xs.length));
      } else if (act === "left" || act === "right") {
        pick(stepList(v, act === "right" ? 1 : -1, ts));
        setCur(0);
      } else if (c != null) {
        // Enter на выбранной строке открывает ту же карточку, что клик мышью
        const el = list.current?.querySelector<HTMLElement>(`[data-row="${c}"]`);
        if (el) openCard(xs[c].task, el);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Строка под курсором всегда видна
  const kbRow = clampRow(cur, items.length);
  useEffect(() => {
    if (kbRow == null) return;
    list.current?.querySelector(`[data-row="${kbRow}"]`)?.scrollIntoView({ block: "nearest" });
  }, [kbRow, view]);
  const show = rowShown(settings);
  const toggleSub = (id: number, done: boolean) => updateSubtask(id, { done: done ? 1 : 0 }).then(() => emit("tasks-changed"), (e) => setError(String(e)));
  const flash = (msg: string, ms = 2200) => (setNote(msg), window.setTimeout(() => setNote((n) => (n === msg ? null : n)), ms));
  // Кружок слева: сделано/вернуть тем же путём, что в главном окне, чтобы у повторяющейся появился следующий повтор
  const toggleDone = async (x: Task) => {
    try {
      if (x.status === "done") await reopenTask(x);
      else if (isBlocked(x)) return flash("Сначала закрой задачи, которые её блокируют", 3200);
      else {
        await completeTask(x);
        setUndo(x);
        window.setTimeout(() => setUndo((u) => (u?.id === x.id ? null : u)), 5000);
      }
      setCard(null);
      await emit("tasks-changed");
    } catch (e) {
      setError(String(e));
    }
  };
  const takeBack = async () => {
    const x = undo;
    if (!x) return;
    setUndo(null);
    try {
      // Свежая запись из базы: после completeTask у повторяющейся появился next_id
      const fresh = (await loadTasks()).find((t) => t.id === x.id);
      if (fresh) await reopenTask(fresh);
      await emit("tasks-changed");
    } catch (e) {
      setError(String(e));
    }
  };
  const openCard = (task: Task, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setCard({ task, top: r.top, bottom: r.bottom });
  };
  const openInMain = (id: number) => invoke("compact_open_task", { id }).catch(() => {});
  // Карточка следует за задачей при обновлении данных; если задачу удалили или закрыли в списке, карточка убирается
  const cardTask = card && tasks.find((t) => t.id === card.task.id);

  return (
    <PeopleCtx.Provider value={people}>
    <div className={`cv-root${side === "left" ? " left" : ""}`}>
      {HANDLES[side].map((h) => (
        <div key={h} className={`cv-grip g-${h}`} onPointerDown={(e) => (e.preventDefault(), invoke("compact_resize", { dir: h }).catch(() => {}))} />
      ))}
      <div className="cv-card">
        <nav className="cv-tabs" aria-label="Списки">
          {tabs.map((v) => {
            const n = countFor(v, tasks);
            return (
              <button key={v} type="button" className={`cv-tab${v === view ? " on" : ""}`} style={{ ["--acc" as string]: `var(--${listAccent(v)})` }}
                data-tip={listName(v)} aria-label={listName(v)} aria-pressed={v === view} onClick={() => pick(v)}>
                <span className="cv-ic"><Icon name={listIcon(v, settings)} size={15} /></span>
                {n > 0 && <span className="cv-n">{n > 99 ? "99+" : n}</span>}
              </button>
            );
          })}
          <button type="button" className={`cv-tab cv-gear${searching ? " on" : ""}`} data-tip="Поиск по названию" aria-label="Поиск по названию"
            aria-pressed={searching} onClick={toggleFind}>
            <Search size={15} />
          </button>
          <button type="button" className={`cv-tab cv-gear${setup ? " on" : ""}`} data-tip="Настройки компактного вида" aria-label="Настройки компактного вида"
            aria-pressed={setup} onClick={() => (setSetup(!setup), setCard(null))}>
            <Gear size={15} />
          </button>
        </nav>
        {setup ? (
          <CompactSettings settings={settings} onBack={() => setSetup(false)} onChanged={reload} />
        ) : (
          <>
        {searching ? (
          <div className="cv-find">
            <Search size={14} />
            <input ref={findRef} className="cv-find-in" value={find} placeholder="Поиск по названию во всех списках" spellCheck={false} maxLength={200}
              onChange={(e) => (setFind(e.target.value), setCard(null), setCur(null))} onFocus={() => setFindFocus(true)} onBlur={() => setFindFocus(false)} />
            {find && <button type="button" className="cv-mini" aria-label="Очистить" onClick={() => (setFind(""), findRef.current?.focus())}><X size={13} /></button>}
          </div>
        ) : (
          <div className="cv-head" style={{ ["--acc" as string]: `var(--${listAccent(view)})` }}>
            <span className="cv-head-ic"><Icon name={listIcon(view, settings)} size={15} /></span>
            <span className="cv-title">{listName(view)}</span>
          </div>
        )}
        <div ref={list} className="cv-list" onScroll={() => setCard(null)}>
          {items.length === 0 && <div className="cv-empty">{error ? `Не загрузилось: ${error}` : searching ? (find?.trim() ? "Ничего не нашлось" : "Введи часть названия") : "Здесь пусто"}</div>}
          {items.map(({ task, group }, i) => {
            return (
              <div key={task.id}>
                {group && <div className="cv-group">{group}</div>}
                <div role="button" tabIndex={0} data-row={i} className={`cv-row${card?.task.id === task.id ? " hot" : ""}${kbRow === i ? " kb" : ""}`}
                  onClick={(e) => openCard(task, e.currentTarget)}
                  onKeyDown={(e) => e.key === "Enter" && openCard(task, e.currentTarget)}>
                  <button type="button" className={`cv-chk${task.status === "done" ? " on" : ""}`} aria-label={task.status === "done" ? "Вернуть в работу" : "Сделано"}
                    data-tip={task.status === "done" ? "Вернуть в работу" : "Сделано"}
                    onClick={(e) => (e.stopPropagation(), toggleDone(task))} onKeyDown={(e) => e.stopPropagation()}>
                    {task.status === "done" && <Check size={10} strokeWidth={3.4} />}
                  </button>
                  <RowMark task={task} show={show} />
                  <span className="cv-name">{searching && find ? marks(task.title || "Без названия", find).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part)) : task.title || "Без названия"}</span>
                  <RowMeta task={task} project={projects.find((p) => p.id === task.project_id)} show={show} onSub={toggleSub} />
                </div>
              </div>
            );
          })}
        </div>
          </>
        )}
        <form className="cv-add" onSubmit={(e) => (e.preventDefault(), save())}>
          <input ref={input} className="field cv-input" value={text} placeholder="Новая задача" spellCheck={false} maxLength={500}
            onChange={(e) => setText(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
          <button type="submit" className="cv-send" disabled={!text.trim()} data-tip="Записать в «Новые»" aria-label="Записать в «Новые»">
            <ArrowUp size={15} strokeWidth={2.4} />
          </button>
        </form>
        {undo && !error ? (
          <div className="cv-note">Сделано: «{undo.title || "Без названия"}» <button type="button" className="cv-undo" onClick={takeBack}>Вернуть</button></div>
        ) : (
          (note || (error && items.length > 0)) && <div className={`cv-note${error ? " err" : ""}`}>{error ? `Не сохранилось: ${error}` : note}</div>
        )}
      </div>
      {card && cardTask && (
        <>
          {/* Клик вне карточки только закрывает её: до строк и кнопок под ним он не доходит */}
          <div className="cv-scrim" onPointerDown={(e) => e.preventDefault()} onClick={() => setCard(null)} onContextMenu={(e) => (e.preventDefault(), setCard(null))} />
          <TaskCard anchor={{ ...card, task: cardTask }} project={projects.find((p) => p.id === cardTask.project_id)} settings={settings}
            onClose={() => setCard(null)} onOpen={openInMain} onSub={toggleSub} />
        </>
      )}
      <Tooltips />
    </div>
    </PeopleCtx.Provider>
  );
}
