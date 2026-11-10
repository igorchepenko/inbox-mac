import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ArrowUp, Settings as Gear } from "lucide-react";
import { addTask, loadProjects, updateSubtask, loadSettings, loadTasks, loadPeopleList, type Person, type Project, type Task } from "./db";
import { Icon } from "./icons";
import { Tooltips } from "./Tooltips";
import { compactItems, compactTabs, rowShown, zoomOf, listAccent, listIcon, listName, savedList, saveList } from "./compactLists";
import { countFor, type ViewId } from "./views";
import { currentZoom } from "./prefs";
import TaskCard, { type CardAnchor } from "./CompactCard";
import CompactSettings from "./CompactSettings";
import { PeopleCtx } from "./PersonCard";
import { RowMark, RowMeta } from "./CompactRow";
import "./compact.css";

/*
 * Окно компактного вида: открывается от значка у правого края экрана (src-tauri/src/compact.rs).
 * Сверху переключатель списков иконками, в строке задачи название и параметры; наведение подсвечивает строку,
 * клик открывает карточку со всем, что есть у задачи (CompactCard.tsx), внизу строка ввода: Enter записывает задачу в «Новые» с одним названием
 */

const hold = (on: boolean) => invoke("compact_hold", { on }).catch(() => {});

/** Ручки по краям окна: тянешь — окно меняет размер. Правый край прижат к значку, поэтому ручек справа нет */
const HANDLES = ["n", "s", "w", "nw", "sw"];

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
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const cardOpen = useRef(false);
  cardOpen.current = !!card;
  
  const reload = () =>
    Promise.all([loadTasks(), loadSettings(), loadProjects(), loadPeopleList()])
      .then(([t, st, p, r]) => (setTasks(t), setSettings(st), setProjects(p), setPeople(r), setError(null)))
      .catch((e) => setError(String(e)));

  useEffect(() => {
    reload();
    const un = [
      listen("compact-open", () => reload()),
      listen("tasks-changed", () => reload()),
      // Окно спряталось: карточку убираем, фокус из строки ввода снимаем, набранный текст остаётся
      listen("compact-hidden", () => (setCard(null), input.current?.blur())),
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      // Открытая карточка закрывается первой; окно остаётся
      if (cardOpen.current) return setCard(null);
      // Первый Esc уводит фокус из строки ввода, следующий закрывает окно
      if (document.activeElement === input.current) input.current?.blur();
      else invoke("compact_hide").catch(() => {});
    };
    addEventListener("keydown", onKey);
    return () => (removeEventListener("keydown", onKey), un.forEach((p) => p.then((f) => f())));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Пока пишешь задачу, окно не закрывается от ухода курсора
  useEffect(() => void hold(focused || text.trim() !== "" || !!card), [focused, text, card]);

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

  const pick = (v: ViewId) => (setView(v), saveList(v), setCard(null), setSetup(false));

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

  const items = compactItems(view, tasks, settings);
  const tabs = compactTabs(settings, tasks, view);
  const show = rowShown(settings);
  const toggleSub = (id: number, done: boolean) => updateSubtask(id, { done: done ? 1 : 0 }).then(() => emit("tasks-changed"), (e) => setError(String(e)));
  const openCard = (task: Task, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setCard({ task, top: r.top, bottom: r.bottom });
  };
  const openInMain = (id: number) => invoke("compact_open_task", { id }).catch(() => {});
  // Карточка следует за задачей при обновлении данных; если задачу удалили или закрыли в списке, карточка убирается
  const cardTask = card && tasks.find((t) => t.id === card.task.id);

  return (
    <PeopleCtx.Provider value={people}>
    <div className="cv-root">
      {HANDLES.map((h) => (
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
          <button type="button" className={`cv-tab cv-gear${setup ? " on" : ""}`} data-tip="Настройки компактного вида" aria-label="Настройки компактного вида"
            aria-pressed={setup} onClick={() => (setSetup(!setup), setCard(null))}>
            <Gear size={15} />
          </button>
        </nav>
        {setup ? (
          <CompactSettings settings={settings} onBack={() => setSetup(false)} onChanged={reload} />
        ) : (
          <>
        <div className="cv-head" style={{ ["--acc" as string]: `var(--${listAccent(view)})` }}>
          <span className="cv-head-ic"><Icon name={listIcon(view, settings)} size={15} /></span>
          <span className="cv-title">{listName(view)}</span>
          <span className="cv-count">{countFor(view, tasks) || ""}</span>
        </div>
        <div className="cv-list" onScroll={() => setCard(null)}>
          {items.length === 0 && <div className="cv-empty">{error ? `Не загрузилось: ${error}` : "Здесь пусто"}</div>}
          {items.map(({ task, group }) => {
            return (
              <div key={task.id}>
                {group && <div className="cv-group">{group}</div>}
                <div role="button" tabIndex={0} className={`cv-row${card?.task.id === task.id ? " hot" : ""}`}
                  onClick={(e) => openCard(task, e.currentTarget)}
                  onKeyDown={(e) => e.key === "Enter" && openCard(task, e.currentTarget)}>
                  <RowMark task={task} show={show} />
                  <span className="cv-name">{task.title || "Без названия"}</span>
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
        {(note || (error && items.length > 0)) && <div className={`cv-note${error ? " err" : ""}`}>{error ? `Не сохранилось: ${error}` : note}</div>}
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
