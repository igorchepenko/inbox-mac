import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import * as db from "./db";
import type { Tag, Task } from "./db";
import { nowStamp } from "./dates";
import type { ViewId } from "./views";
import { KEY_PROJECTS_COLLAPSED, KEY_TAGS_COLLAPSED } from "./Sidebar";
import { DEMO_TAG, DEMO_TITLE, TOUR_STEPS, tipAt, union, type Box } from "./onb";
import "./onboarding.css";

/*
 * Первый запуск и два онбординга.
 * Welcome: имя и выбор онбординга. Intro: четыре слайда о приложении.
 * Tour: подсветка настоящих элементов интерфейса. Элементы помечены data-onb, шаги описаны в onb.ts.
 */

// ── Первый запуск ──

export function Welcome(props: { name: string; onDone: (name: string, next: "intro" | "tour" | "later") => void }) {
  const [step, setStep] = useState<"name" | "pick">("name");
  const [name, setName] = useState(props.name);
  const clean = name.trim() || props.name;
  return (
    <div className="onb-overlay">
      <div className="dialog onb-card" role="dialog" aria-label="Добро пожаловать в Inbox">
        {step === "name" ? (
          <form className="onb-col" onSubmit={(e) => (e.preventDefault(), setStep("pick"))}>
            <h2>Добро пожаловать в Inbox</h2>
            <p className="onb-lead">Как к тебе обращаться?</p>
            <input className="field onb-input" autoFocus value={name} placeholder="Твоё имя" spellCheck={false} onChange={(e) => setName(e.target.value)} />
            <p className="hint">Это имя профиля. Его можно поменять в Настройках → Профиль.</p>
            <button type="submit" className="cta stand narrow">Продолжить</button>
          </form>
        ) : (
          <div className="onb-col">
            <h2>Привет, {clean}!</h2>
            <p className="onb-lead">Выбери, как познакомиться с Inbox. Твои задачи это не затронет.</p>
            <div className="onb-pick">
              <button type="button" className="onb-opt" onClick={() => props.onDone(clean, "intro")}>
                <b>Знакомство</b><span>4 слайда, минута: что это и что умеет</span>
              </button>
              <button type="button" className="onb-opt" onClick={() => props.onDone(clean, "tour")}>
                <b>Показать на деле</b><span>Подсветим элементы и вместе проведём задачу до «Завершённых»</span>
              </button>
            </div>
            <button type="button" className="btn" onClick={() => props.onDone(clean, "later")}>Позже</button>
            <p className="hint">Передумаешь: Настройки → Онбординг.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Знакомство ──

const SLIDES: { title: string; head: string; text: ReactNode; art: ReactNode }[] = [
  { title: "Что такое Inbox", head: "Личные задачи, которые вводятся за секунду",
    text: "Inbox — твой личный список дел на Маке. Всё хранится только у тебя на компьютере. Записал мысль мгновенно, разобрал позже.",
    art: <div className="onb-art"><i className="onb-chip c1">Записать</i>→<i className="onb-chip c2">Разобрать</i>→<i className="onb-chip c3">Сделать</i>→<i className="onb-chip c4">Готово</i></div> },
  { title: "Быстрый ввод", head: "Одно сочетание из любой программы",
    text: "Нажми сочетание быстрого ввода: откроется строка поверх всего. Пиши обычной фразой, дата, время, #тег и @человек распознаются сами.",
    art: <div className="onb-art"><div className="onb-quick">Позвонить @Андрей завтра в 15:00 #клиенты</div></div> },
  { title: "Порядок", head: "Пространства, теги и люди",
    text: "Пространства — большие области (Работа, Дом). Теги — метки поперёк них. Люди — кто назначил задачу или участвует во встрече.",
    art: <div className="onb-art"><i className="onb-chip c3">Работа</i><i className="onb-chip c2">#клиенты</i><i className="onb-chip c1">Андрей</i></div> },
  { title: "Что ещё умеет", head: "Виды, поиск, напоминания",
    text: "Список, канбан и календарь. Умные списки «Новые», «Сегодня», «Скоро». Точный поиск, напоминания, дашборд и «Завершённые» для готового.",
    art: <div className="onb-art"><i className="onb-chip c4">Список</i><i className="onb-chip c4">Канбан</i><i className="onb-chip c4">Календарь</i><i className="onb-chip c2">Поиск</i></div> },
];

export function Intro(props: { quickKey: string; onClose: (finished: boolean) => void }) {
  const [i, setI] = useState(0);
  const s = SLIDES[i], last = i === SLIDES.length - 1;
  useEscape(() => props.onClose(false));
  return (
    <div className="onb-overlay">
      <div className="dialog onb-card" role="dialog" aria-label="Знакомство с Inbox">
        <div className="onb-step">{s.title} · {i + 1} из {SLIDES.length}</div>
        <h2>{s.head}</h2>
        <p className="onb-lead">{s.text}{i === 1 && <> Сейчас это <kbd>{props.quickKey}</kbd>.</>}</p>
        {s.art}
        <div className="onb-foot">
          <button type="button" className="btn" onClick={() => (i ? setI(i - 1) : props.onClose(false))}>{i ? "Назад" : "Пропустить"}</button>
          <span className="onb-dots">{SLIDES.map((_, k) => <b key={k} className={k === i ? "on" : ""} />)}</span>
          <button type="button" className="cta stand narrow" autoFocus onClick={() => (last ? props.onClose(true) : setI(i + 1))}>{last ? "Готово" : "Дальше"}</button>
        </div>
      </div>
    </div>
  );
}

function useEscape(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, []);
}

// ── Показать на деле ──

export interface TourProps {
  tasks: Task[];
  tags: Tag[];
  sel: number | null;
  formOpen: boolean;
  quickKey: string;
  openView: (v: ViewId) => void;
  openForm: (title: string) => void;
  closeForm: () => void;
  setSetting: (key: string, value: string) => void;
  reload: () => Promise<unknown>;
  onClose: (finished: boolean) => void;
}

function boxOf(selectors: string[], demoId: number | undefined): Box | null {
  const boxes: Box[] = [];
  for (const sel of selectors) {
    const el = document.querySelector(sel.replace("{demo}", String(demoId ?? 0)));
    const r = el?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) boxes.push({ left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return union(boxes);
}

export function Tour(props: TourProps) {
  const steps = useMemo(() => TOUR_STEPS(props.quickKey), [props.quickKey]);
  const [i, setI] = useState(0);
  const [ending, setEnding] = useState(false);
  const [keepTag, setKeepTag] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const step = steps[i];
  // Что было до онбординга: по нему находим учебную задачу и тег и потом убираем только их
  const base = useRef<{ ids: Set<number>; tags: Set<string> } | null>(null);
  if (!base.current) base.current = { ids: new Set(props.tasks.map((t) => t.id)), tags: new Set(props.tags.map((t) => t.name.toLowerCase())) };
  const demo = props.tasks.find((t) => !base.current!.ids.has(t.id));
  const demoTag = props.tags.find((t) => t.name.toLowerCase() === DEMO_TAG && !base.current!.tags.has(DEMO_TAG));

  const ok = !step.wait || skipped ||
    (step.wait === "created" ? !!demo : step.wait === "selected" ? !!demo && props.sel === demo.id : !!demo && (demo.status === "done" || demo.status === "archived"));

  // Вход в шаг: открыть нужный вид и показать нужное
  const archived = useRef(false);
  useEffect(() => {
    setSkipped(false);
    if (step.id === "form" && !demo) props.openForm(DEMO_TITLE);
    else props.closeForm();
    if (step.view && step.id !== "form") props.openView(step.view as ViewId);
    if (step.id === "spaces") props.setSetting(KEY_PROJECTS_COLLAPSED, "0");
    if (step.id === "tags") props.setSetting(KEY_TAGS_COLLAPSED, "0");
    if (step.id === "archive" && demo && !archived.current) {
      // Сделанное лежит в списке до завтра; для примера переносим сразу
      archived.current = true;
      db.updateTask(demo.id, { status: "archived", done_at: demo.done_at ?? nowStamp() }).then(() => props.reload());
    }
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  // Рамка подсвеченного: окно может меняться, поэтому читаем её регулярно
  const demoRef = useRef<number | undefined>(undefined);
  demoRef.current = demo?.id;
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const read = () => {
      const b = step.target ? boxOf(step.target, demoRef.current) : null;
      setBox((cur) => (cur && b && cur.left === b.left && cur.top === b.top && cur.width === b.width && cur.height === b.height ? cur : b));
      setView((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
    };
    read();
    const t = setInterval(read, 120);
    return () => clearInterval(t);
  }, [step]);

  const tipRef = useRef<HTMLDivElement>(null);
  const [tipSize, setTipSize] = useState({ w: 300, h: 160 });
  useLayoutEffect(() => {
    const r = tipRef.current?.getBoundingClientRect();
    if (r && (Math.round(r.width) !== tipSize.w || Math.round(r.height) !== tipSize.h)) setTipSize({ w: Math.round(r.width), h: Math.round(r.height) });
  });
  const pos = tipAt(ending ? null : box, tipSize, view);

  const cleanup = async () => {
    try {
      if (demo) await db.deleteTask(demo.id);
      if (demoTag && !keepTag) await db.deleteTag(demoTag.id);
    } catch { /* учебные данные не критичны: останутся, их можно удалить руками */ }
    await props.reload();
  };
  const close = async (finished: boolean) => {
    props.closeForm();
    await cleanup();
    props.onClose(finished);
  };
  useEscape(() => void close(false));

  const next = () => (i === steps.length - 1 ? setEnding(true) : setI(i + 1));
  const pad = 6;
  const hole = !ending && box ? { left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 } : null;

  return (
    <div className="onb-tour">
      {hole ? (<>
        <div className="onb-veil" style={{ left: 0, top: 0, right: 0, height: Math.max(0, hole.top) }} />
        <div className="onb-veil" style={{ left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height }} />
        <div className="onb-veil" style={{ left: hole.left + hole.width, top: hole.top, right: 0, height: hole.height }} />
        <div className="onb-veil" style={{ left: 0, top: hole.top + hole.height, right: 0, bottom: 0 }} />
        <div className="onb-ring" style={hole} />
      </>) : <div className="onb-veil" style={{ inset: 0 }} />}
      <div ref={tipRef} className="onb-tip" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label={ending ? "Готово" : step.title}>
        {ending ? (<>
          <div className="onb-step">Готово</div>
          <h3>Теперь ты знаешь основное</h3>
          <p>Учебная задача удалится{demoTag ? "" : "."}{demoTag && <>, а тег <b>#{DEMO_TAG}</b> можно оставить.</>}</p>
          {demoTag && (
            <label className="onb-keep"><input type="checkbox" checked={keepTag} onChange={(e) => setKeepTag(e.target.checked)} /> Оставить тег #{DEMO_TAG}</label>
          )}
          <div className="onb-foot"><button type="button" className="cta stand narrow" autoFocus onClick={() => void close(true)}>Завершить</button></div>
        </>) : (<>
          <div className="onb-step">Шаг {i + 1} из {steps.length}</div>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
          {step.id === "form" && !props.formOpen && !demo && (
            <button type="button" className="btn small" onClick={() => props.openForm(DEMO_TITLE)}>Открыть форму снова</button>
          )}
          <div className="onb-foot">
            <button type="button" className="btn small" onClick={() => void close(false)}>Выйти</button>
            {!ok && <button type="button" className="onb-link" onClick={() => setSkipped(true)}>Пропустить шаг</button>}
            <span className="onb-sp" />
            {!ok && step.waitHint && <span className="onb-wait">{step.waitHint}</span>}
            {i > 0 && <button type="button" className="btn small" onClick={() => setI(i - 1)}>Назад</button>}
            <button type="button" className="cta stand narrow" disabled={!ok} onClick={next}>{ok && step.wait ? <><Check size={13} /> Дальше</> : "Дальше"}</button>
          </div>
        </>)}
      </div>
    </div>
  );
}
