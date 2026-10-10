import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Monitor, Moon, Sun } from "lucide-react";
import { dayKey, MONTHS, pad, parseDay, today, WEEKDAYS, weekdayIndex } from "./dates";
import { Icon, ICONS } from "./icons";
import type { ProjectFields } from "./db";
import { PALETTE, swatchOf } from "./palette";
import { setTheme, savedTheme, type Theme } from "./theme";

/** Высота textarea растёт вместе с текстом. Пересчитывается и при смене ширины окна */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, max = 420) {
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el || !el.clientWidth) return; // в спрятанном окне ширины ещё нет, мерить рано
      el.style.height = "auto";
      const h = el.scrollHeight + (el.offsetHeight - el.clientHeight);
      el.style.height = `${Math.min(h, max)}px`;
      el.style.overflowY = h > max ? "auto" : "hidden";
    };
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, [ref, value, max]);
}

/** Всплывающая панель под кнопкой-якорем. Закрывается по клику мимо и по Esc */
export function Popover(props: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!props.anchor || !ref.current) return;
    const a = props.anchor.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    const top = a.bottom + 6 + p.height > innerHeight - 8 ? Math.max(8, a.top - 6 - p.height) : a.bottom + 6;
    const left = Math.min(Math.max(8, a.left), innerWidth - p.width - 8);
    setPos({ top, left });
  }, [props.anchor]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !props.anchor?.contains(t)) props.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
    };
  });
  return (
    <div ref={ref} className="popover" style={{ width: props.width, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
      {props.children}
    </div>
  );
}


/**
 * Календарь месяца в стиле приложения, неделя с понедельника.
 * Клик по названию месяца открывает выбор месяца, второй клик — выбор года: дата через пару лет в три клика
 */
export function Calendar(props: { value: string | null; onPick: (day: string | null) => void }) {
  const t = today();
  const start = parseDay(props.value ?? t);
  const now = parseDay(t);
  const [month, setMonth] = useState(new Date(start.getFullYear(), start.getMonth(), 1));
  const [mode, setMode] = useState<"days" | "months" | "years">("days");
  const y = month.getFullYear();
  const first = new Date(month);
  first.setDate(1 - weekdayIndex(month));
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
  const decade = y - ((y - now.getFullYear()) % 12 + 12) % 12; // 12 лет на экране, текущий год в первой ячейке
  const shift = (n: number) => {
    if (mode === "days") setMonth(new Date(y, month.getMonth() + n, 1));
    else setMonth(new Date(y + n * (mode === "months" ? 1 : 12), month.getMonth(), 1));
  };
  const title = mode === "days" ? `${MONTHS[month.getMonth()]} ${y}` : mode === "months" ? String(y) : `${decade}–${decade + 11}`;
  const unit = mode === "days" ? "месяц" : mode === "months" ? "год" : "12 лет";
  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="cal-nav" onClick={() => shift(-1)} aria-label={`Назад на ${unit}`}><ChevronLeft size={16} /></button>
        <button type="button" className="cal-title" disabled={mode === "years"}
          title={mode === "days" ? "Выбрать месяц и год" : mode === "months" ? "Выбрать год" : undefined}
          onClick={() => setMode(mode === "days" ? "months" : "years")}>{title}</button>
        <button type="button" className="cal-nav" onClick={() => shift(1)} aria-label={`Вперёд на ${unit}`}><ChevronRight size={16} /></button>
      </div>
      {mode === "days" && (
        <div className="cal-grid">
          {WEEKDAYS.map((w) => <span key={w} className="cal-wd">{w}</span>)}
          {days.map((d) => {
            const k = dayKey(d);
            const cls = ["cal-day", d.getMonth() !== month.getMonth() && "other", k === t && "today", k === props.value && "on", k < t && "past"]
              .filter(Boolean).join(" ");
            return <button type="button" key={k} className={cls} onClick={() => props.onPick(k)}>{d.getDate()}</button>;
          })}
        </div>
      )}
      {mode === "months" && (
        <div className="cal-pick">
          {MONTHS.map((m, i) => {
            const cls = [y === start.getFullYear() && i === start.getMonth() && props.value && "on", y === now.getFullYear() && i === now.getMonth() && "now"];
            return (
              <button type="button" key={m} className={cls.filter(Boolean).join(" ")}
                onClick={() => (setMonth(new Date(y, i, 1)), setMode("days"))}>{m}</button>
            );
          })}
        </div>
      )}
      {mode === "years" && (
        <div className="cal-pick">
          {Array.from({ length: 12 }, (_, i) => decade + i).map((yy) => {
            const cls = [yy === start.getFullYear() && props.value && "on", yy === now.getFullYear() && "now"];
            return (
              <button type="button" key={yy} className={cls.filter(Boolean).join(" ")}
                onClick={() => (setMonth(new Date(yy, month.getMonth(), 1)), setMode("months"))}>{yy}</button>
            );
          })}
        </div>
      )}
      <div className="cal-foot">
        <button type="button" className="link" onClick={() => props.onPick(t)}>Сегодня</button>
        {mode !== "days" ? (
          <button type="button" className="link" onClick={() => setMode("days")}>К дням</button>
        ) : props.value && <button type="button" className="link" onClick={() => props.onPick(null)}>Убрать дату</button>}
      </div>
    </div>
  );
}

/**
 * Время в два поля: часы и минуты. Пусто по умолчанию.
 * После двух цифр часа курсор сам переходит на минуты; «7» в часах сразу становится «07».
 */
export function TimeInput(props: { value: string; disabled?: boolean; onCommit: (hhmm: string) => void }) {
  const [hh, setHh] = useState(props.value.slice(0, 2));
  const [mm, setMm] = useState(props.value.slice(3, 5));
  const hRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setHh(props.value.slice(0, 2));
    setMm(props.value.slice(3, 5));
  }, [props.value]);

  const commit = (h = hh, m = mm) => {
    if (!h) {
      if (props.value) props.onCommit("");
      setMm("");
      return;
    }
    const hhmm = `${pad(Number(h))}:${pad(Number(m || 0))}`;
    if (hhmm !== props.value) props.onCommit(hhmm);
    else {
      setHh(hhmm.slice(0, 2));
      setMm(hhmm.slice(3, 5));
    }
  };
  const onHour = (v: string) => {
    v = v.replace(/\D/g, "").slice(0, 2);
    if (v.length === 1 && Number(v) > 2) v = `0${v}`;
    if (v.length === 2 && Number(v) > 23) v = "23";
    setHh(v);
    if (v.length === 2) mRef.current?.focus();
  };
  const onMinute = (v: string) => {
    v = v.replace(/\D/g, "").slice(0, 2);
    if (v.length === 1 && Number(v) > 5) v = `0${v}`;
    setMm(v);
    if (v.length === 2) commit(hh, v);
  };
  return (
    <div ref={box} className={`time-in field ${props.disabled ? "disabled" : ""}`}
      onBlur={(e) => !box.current?.contains(e.relatedTarget as Node) && commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLElement).blur();
        if (e.key === "Escape") {
          setHh(props.value.slice(0, 2));
          setMm(props.value.slice(3, 5));
        }
      }}>
      <input ref={hRef} value={hh} placeholder="чч" inputMode="numeric" disabled={props.disabled} aria-label="Часы"
        onChange={(e) => onHour(e.target.value)} onFocus={(e) => e.target.select()} />
      <span>:</span>
      <input ref={mRef} value={mm} placeholder="мм" inputMode="numeric" disabled={props.disabled} aria-label="Минуты"
        onChange={(e) => onMinute(e.target.value)} onFocus={(e) => e.target.select()}
        onKeyDown={(e) => e.key === "Backspace" && !mm && (e.preventDefault(), hRef.current?.focus())} />
    </div>
  );
}

export function IconGrid(props: { value: string; accent: string; onPick: (name: string) => void }) {
  return (
    <div className="icon-grid">
      {Object.keys(ICONS).map((name) => (
        <button type="button" key={name} className={`icon-cell ${props.value === name ? "on" : ""}`}
          style={props.value === name ? { background: `var(--${props.accent})`, color: "var(--on-acc)" } : undefined}
          onClick={() => props.onPick(name)} title={name}>
          <Icon name={name} size={16} />
        </button>
      ))}
    </div>
  );
}

/** Тема: быстрый переключатель в углу меню и он же, с подписями (wide), в настройках */
export function ThemeSwitch(props: { wide?: boolean }) {
  const [t, setT] = useState<Theme>(savedTheme());
  // Два переключателя в одном окне должны показывать одно и то же
  useEffect(() => {
    const on = (e: Event) => setT((e as CustomEvent<Theme>).detail);
    window.addEventListener("inbox-theme", on);
    return () => window.removeEventListener("inbox-theme", on);
  }, []);
  const opts: [Theme, ReactNode, string][] = [
    ["system", <Monitor size={14} />, "Как в системе"],
    ["light", <Sun size={14} />, "Светлая"],
    ["dark", <Moon size={14} />, "Тёмная"],
  ];
  return (
    <div className={`theme-switch ${props.wide ? "wide" : ""}`} role="radiogroup" aria-label="Тема">
      {opts.map(([v, icon, label]) => (
        <button key={v} role="radio" aria-checked={t === v} title={label} className={t === v ? "on" : ""}
          onClick={() => (setTheme(v), setT(v))}>{icon}{props.wide && <span>{label}</span>}</button>
      ))}
    </div>
  );
}

/** Создание и редактирование проекта: название, описание, цвет, иконка */
/** Палитра проектов сеткой 8×4. Стрелки двигают выбор, имя цвета в подсказке и над сеткой */
export function ColorGrid({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  const move = (e: ReactKeyboardEvent, i: number) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = PALETTE[(i + step + PALETTE.length) % PALETTE.length];
    onPick(next.id);
    (e.currentTarget.parentElement?.children[PALETTE.indexOf(next)] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className="color-grid" role="radiogroup" aria-label="Цвет пространства">
      {PALETTE.map((c, i) => (
        <button type="button" key={c.id} role="radio" aria-checked={value === c.id} aria-label={c.name} data-tip={c.name}
          tabIndex={value === c.id || (!swatchOf(value) && i === 0) ? 0 : -1}
          className={`color-dot ${value === c.id ? "on" : ""}`} style={{ "--c": `var(--${c.id})` } as CSSProperties}
          onClick={() => onPick(c.id)} onKeyDown={(e) => move(e, i)} />
      ))}
    </div>
  );
}

export function ProjectDialog(props: {
  initial?: ProjectFields;
  onSave: (p: ProjectFields) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [p, setP] = useState<ProjectFields>(props.initial ?? { name: "", description: "", color: "violet", icon: "folder" });
  const [armed, setArmed] = useState(false);
  const desc = useRef<HTMLTextAreaElement>(null);
  useAutosize(desc, p.description, 200);
  const save = () => p.name.trim() && props.onSave({ ...p, name: p.name.trim(), description: p.description.trim() });
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form className="dialog" onSubmit={(e) => (e.preventDefault(), save())}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onClose();
          if (e.key === "Enter" && e.metaKey) save();
        }}>
        <h3>{props.initial ? "Пространство" : "Новое пространство"}</h3>
        <input className="field dlg-name" autoFocus placeholder="Название" value={p.name}
          onChange={(e) => setP({ ...p, name: e.target.value })} />
        <textarea ref={desc} className="field dlg-desc" placeholder="Описание: зачем это пространство, что в него попадает" rows={2}
          value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !e.metaKey && e.stopPropagation()} />
        <div className="lbl">Цвет <span className="lbl-val">{swatchOf(p.color)?.name ?? ""}</span></div>
        <ColorGrid value={p.color} onPick={(color) => setP({ ...p, color })} />
        <div className="lbl">Иконка</div>
        <IconGrid value={p.icon} accent={p.color} onPick={(icon) => setP({ ...p, icon })} />
        <div className="dlg-foot">
          {props.onDelete && (
            <button type="button" className={`link danger ${armed ? "armed" : ""}`} onBlur={() => setArmed(false)}
              title="Задачи пространства останутся, просто без пространства"
              onClick={() => (armed ? props.onDelete!() : setArmed(true))}>
              {armed ? "Точно удалить? Задачи останутся" : "Удалить пространство"}
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={props.onClose}>Отмена</button>
          <button type="submit" className="cta stand narrow" disabled={!p.name.trim()}>Сохранить</button>
        </div>
      </form>
    </div>
  );
}
