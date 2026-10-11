import { useEffect, useRef, useState, type ReactNode } from "react";
import { BellRing, Check, FolderOpen, Keyboard, LayoutDashboard, PanelLeft, RotateCcw, SlidersHorizontal, Type, UserRound, X, type LucideIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { Icon } from "./icons";
import { plural, VIEWS, type ViewId } from "./views";
import { alertOf, DEADLINE_DAYS } from "./deadline";
import { IconGrid, Popover, ThemeSwitch, TimeInput } from "./widgets";
import { savedTheme, setTheme } from "./theme";
import { HomeSettings } from "./HomeSettings";
import { HomeIcon } from "./home/Home";
import { QuickKeyTest } from "./QuickKeyCheck";
import { activeProfile, PROFILES, switchProfile } from "./profile";
import { ensurePermission, notify } from "./reminders";
import {
  accelFromEvent, DEFAULT_APPEARANCE, DEFAULTS, FONTS, labelFromAccel, pref, savedAppearance, setAppearance, SIZES, SOUNDS, type Appearance,
} from "./prefs";

export interface SettingsProps {
  settings: Record<string, string>;
  onSet: (key: string, value: string) => void;
  /** Сменить сочетание быстрого ввода. Возвращает текст ошибки, если сочетание не удалось занять */
  onQuickShortcut: (accel: string) => Promise<string | null>;
  shortcutError: string | null;
  onClose: () => void;
}

// Разделы по порядку в левой колонке. Новый раздел достаточно добавить сюда
const SECTIONS: { id: string; name: string; icon: LucideIcon; render: (p: SettingsProps) => ReactNode }[] = [
  { id: "general", name: "Основные", icon: SlidersHorizontal, render: (p) => <General {...p} /> },
  { id: "look", name: "Внешний вид", icon: Type, render: () => <Look /> },
  { id: "quick", name: "Быстрый ввод", icon: Keyboard, render: (p) => <Quick {...p} /> },
  { id: "notify", name: "Уведомления", icon: BellRing, render: (p) => <Notifications {...p} /> },
  { id: "menu", name: "Меню", icon: PanelLeft, render: (p) => <MenuItems {...p} /> },
  { id: "home", name: "Главная", icon: LayoutDashboard, render: (p) => <HomeSettings settings={p.settings} onSet={p.onSet} /> },
  { id: "profile", name: "Профиль", icon: UserRound, render: () => <Profiles /> },
];

/** Окно настроек поверх приложения. Открывается по ⌘, из меню Inbox и иконкой-шестерёнкой внизу меню */
export function Settings(props: SettingsProps) {
  const [tab, setTab] = useState(SECTIONS[0].id);
  const section = SECTIONS.find((s) => s.id === tab)!;
  // Фокус в окно, чтобы Esc сразу закрывал его
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div ref={box} tabIndex={-1} className="settings" role="dialog" aria-label="Настройки"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) props.onClose();
        }}>
        <nav className="set-nav">
          <h3>Настройки</h3>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`nav ${tab === s.id ? "on" : ""}`} onClick={() => setTab(s.id)}>
              <s.icon size={15} strokeWidth={2.2} /> <span className="nav-name">{s.name}</span>
            </button>
          ))}
        </nav>
        <div className="set-body">
          <div className="set-head">
            <h2>{section.name}</h2>
            <button className="cal-nav" onClick={props.onClose} title="Закрыть (Esc)"><X size={16} /></button>
          </div>
          {section.render(props)}
        </div>
      </div>
    </div>
  );
}

// ── Общие кусочки ──

/** Значение по умолчанию у параметра: подпись, что стоит изначально, и сброс, если значение другое */
export interface Def {
  /** Текст исходного значения, например «SF Pro» */
  text: string;
  changed: boolean;
  reset: () => void;
}

export function Row(props: { name: string; hint?: ReactNode; def?: Def; children: ReactNode }) {
  const d = props.def;
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-name">
          {props.name}
          {d?.changed && <span className="set-dot" title="Отличается от значения по умолчанию" />}
        </div>
        {props.hint && <div className="hint">{props.hint}</div>}
        {d && (
          <div className="set-def">
            По умолчанию: <b>{d.text}</b>
            {d.changed && <button type="button" className="link" onClick={d.reset}>Сбросить</button>}
          </div>
        )}
      </div>
      <div className="set-ctl">{props.children}</div>
    </div>
  );
}

/** Общий сброс раздела внизу: неактивен, пока всё стоит как по умолчанию */
export function ResetSection(props: { name: string; changed: boolean; onReset: () => void }) {
  return (
    <div className="set-reset">
      <button type="button" className="btn small" disabled={!props.changed} onClick={props.onReset}>
        <RotateCcw size={13} /> Сбросить раздел «{props.name}»
      </button>
      <span className="hint">{props.changed ? "Все параметры раздела вернутся к значениям по умолчанию" : "В разделе всё как по умолчанию"}</span>
    </div>
  );
}

export function Toggle(props: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={props.on} aria-label={props.label} disabled={props.disabled}
      className={`toggle ${props.on ? "on" : ""}`} onClick={() => props.onChange(!props.on)} />
  );
}

function Choice<T extends string>(props: { value: T; options: { id: T; name: ReactNode }[]; onPick: (v: T) => void; accent?: string }) {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button type="button" key={o.id} className={`chip ${props.value === o.id ? "on" : ""}`}
          style={props.value === o.id ? { background: `var(--${props.accent ?? "stand"})` } : undefined}
          onClick={() => props.onPick(o.id)}>{o.name}</button>
      ))}
    </div>
  );
}

// ── Разделы ──

function General(p: SettingsProps) {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    autostartEnabled().then(setAutostart).catch(() => setAutostart(false));
  }, []);
  const toggleAutostart = async (on: boolean) => {
    try {
      await (on ? enableAutostart() : disableAutostart());
      setAutostart(await autostartEnabled());
    } catch {
      setAutostart(!on);
    }
  };
  const visible = VIEWS.filter((v) => v.id === "inbox" || p.settings[`hidden:${v.id}`] !== "1");
  const startView = pref(p.settings, "start.view");
  const startName = (id: string) => (id === "home" ? "Главная" : id === "last" ? "Где остановился" : VIEWS.find((v) => v.id === id)?.name ?? id);
  const resetStart = () => p.onSet("start.view", DEFAULTS["start.view"]);
  return (
    <div className="set-group">
      <Row name="Начальный экран" hint="Что открыто при запуске"
        def={{ text: startName(DEFAULTS["start.view"]), changed: startView !== DEFAULTS["start.view"], reset: resetStart }}>
        <Choice value={pref(p.settings, "start.view")} onPick={(v) => p.onSet("start.view", v)}
          options={[
            { id: "home", name: "Главная" },
            ...visible.filter((v) => v.id !== "archive").map((v) => ({ id: v.id as string, name: v.name })),
            { id: "last", name: "Где остановился" },
          ]} />
      </Row>
      <Row name="Открывать при входе в систему"
        hint="Inbox запустится сам после включения Мака, и быстрый ввод с напоминаниями будут работать сразу"
        def={{ text: "выключено", changed: !!autostart, reset: () => toggleAutostart(false) }}>
        <Toggle label="Открывать при входе" on={!!autostart} disabled={autostart === null} onChange={toggleAutostart} />
      </Row>
      <ResetSection name="Основные" changed={startView !== DEFAULTS["start.view"] || !!autostart}
        onReset={() => (resetStart(), autostart && toggleAutostart(false))} />
    </div>
  );
}

function Profiles() {
  const cur = activeProfile();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="set-group">
      <Row name="Активный профиль"
        hint="«Тест» для проверки новых сборок, «Игорь» для настоящих задач. У каждого свои задачи, пространства и настройки. Быстрый ввод пишет в активный. Переключиться можно и в меню Inbox в строке меню">
        <div className="seg">
          {PROFILES.map((p) => (
            <button type="button" key={p.id} className={`chip ${cur === p.id ? "on" : ""}`} data-profile={p.id}
              style={cur === p.id ? { background: "var(--profile)" } : undefined}
              onClick={() => switchProfile(p.id)}>
              {cur === p.id && <Check size={13} />} {p.name}
            </button>
          ))}
        </div>
      </Row>
      <Row name="Копии базы"
        hint="Перед первым запуском каждой новой версии Inbox сохраняет копию базы профиля. Хранятся последние 10">
        <button type="button" className="btn small" onClick={() => invoke("open_backups").then(() => setErr(null), (e) => setErr(String(e)))}>
          <FolderOpen size={13} /> Показать в Finder
        </button>
      </Row>
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function Look() {
  const [a, setA] = useState<Appearance>(savedAppearance());
  const [theme, setT] = useState(savedTheme());
  const set = (next: Appearance) => (setA(next), setAppearance(next));
  const D = DEFAULT_APPEARANCE;
  const resetTheme = () => (setTheme("system"), setT("system"));
  // Тему может сменить и переключатель в меню слева
  useEffect(() => {
    const on = (e: Event) => setT((e as CustomEvent<typeof theme>).detail);
    window.addEventListener("inbox-theme", on);
    return () => window.removeEventListener("inbox-theme", on);
  }, []);
  const changed = theme !== "system" || a.font !== D.font || a.size !== D.size;
  return (
    <div className="set-group">
      <Row name="Тема" hint="Быстрый переключатель остаётся и внизу меню слева"
        def={{ text: "как в системе", changed: theme !== "system", reset: resetTheme }}>
        <ThemeSwitch wide />
      </Row>
      <Row name="Шрифт" def={{ text: FONTS.find((f) => f.id === D.font)!.name, changed: a.font !== D.font, reset: () => set({ ...a, font: D.font }) }}>
        <div className="seg">
          {FONTS.map((f) => (
            <button type="button" key={f.id} className={`font-card ${a.font === f.id ? "on" : ""}`} onClick={() => set({ ...a, font: f.id })}>
              <span className="font-sample" style={{ fontFamily: f.stack }}>Аа</span>
              <span>{f.name}{f.id === D.font && <i className="def-mark" title="По умолчанию">●</i>}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row name="Размер" hint="Меняет масштаб всего окна: текст, отступы и иконки вместе"
        def={{ text: SIZES.find((s) => s.id === D.size)!.name, changed: a.size !== D.size, reset: () => set({ ...a, size: D.size }) }}>
        <Choice value={a.size} onPick={(size) => set({ ...a, size })} options={SIZES.map((s) => ({ id: s.id, name: s.name }))} />
      </Row>
      <ResetSection name="Внешний вид" changed={changed} onReset={() => (resetTheme(), set(D))} />
    </div>
  );
}

function Quick(p: SettingsProps) {
  const current = pref(p.settings, "quick.shortcut");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (accel: string) => {
    setBusy(true);
    const err = await p.onQuickShortcut(accel);
    setBusy(false);
    setError(err);
  };

  // Пока идёт запись, все нажатия перехватываем, чтобы они не сработали как команды приложения
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape" && !e.metaKey && !e.altKey && !e.ctrlKey) return setRecording(false);
      const r = accelFromEvent(e);
      if (r === null) return;
      if (typeof r === "object") return setError(r.error);
      setRecording(false);
      apply(r);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const shownError = error ?? p.shortcutError;
  return (
    <div className="set-group">
      <Row name="Сочетание клавиш"
        hint="Открывает карточку «Что нужно сделать?» поверх любого приложения. Нажми на поле и затем нужные клавиши"
        def={{ text: labelFromAccel(DEFAULTS["quick.shortcut"]), changed: current !== DEFAULTS["quick.shortcut"], reset: () => apply(DEFAULTS["quick.shortcut"]) }}>
        <button type="button" className={`key-rec ${recording ? "rec" : ""}`} disabled={busy}
          onClick={() => (setError(null), setRecording(!recording))}>
          {recording ? "Нажми сочетание…" : labelFromAccel(current)}
        </button>
      </Row>
      {shownError && <div className="error">{shownError}</div>}
      <QuickKeyTest />
      <Row name="Без клавиатуры" hint="Карточка открывается и кликом по иконке Inbox в строке меню">
        <span />
      </Row>
      <ResetSection name="Быстрый ввод" changed={current !== DEFAULTS["quick.shortcut"]} onReset={() => apply(DEFAULTS["quick.shortcut"])} />
    </div>
  );
}

function Notifications(p: SettingsProps) {
  const enabled = pref(p.settings, "remind.enabled") === "1";
  const sound = pref(p.settings, "remind.sound");
  const digest = pref(p.settings, "digest.enabled") === "1";
  const digestChanged = digest !== (DEFAULTS["digest.enabled"] === "1") || pref(p.settings, "digest.time") !== DEFAULTS["digest.time"];
  const dl = alertOf(p.settings);
  const dlKeys = ["deadline.notify", "deadline.days", "deadline.time"] as const;
  const dlChanged = dlKeys.some((k) => pref(p.settings, k) !== DEFAULTS[k]);
  const notifChanged = enabled !== (DEFAULTS["remind.enabled"] === "1") || sound !== DEFAULTS["remind.sound"] || digestChanged || dlChanged;
  const resetNotif = () => (["remind.enabled", "remind.sound", "digest.enabled", "digest.time", ...dlKeys] as const).forEach((k) => p.onSet(k, DEFAULTS[k]));
  const [tested, setTested] = useState<string | null>(null);
  const test = async () => {
    if (!(await ensurePermission())) return setTested("macOS не дал разрешения. Включи уведомления для Inbox в Системных настройках → Уведомления");
    notify(p.settings, "Проверка уведомлений", "Так будут выглядеть напоминания Inbox");
    setTested(null);
  };
  return (
    <div className="set-group">
      <Row name="Уведомления" hint="Когда выключены, напоминания проходят молча, а задачи остаются на своих местах"
        def={{ text: DEFAULTS["remind.enabled"] === "1" ? "включены" : "выключены", changed: enabled !== (DEFAULTS["remind.enabled"] === "1"), reset: () => p.onSet("remind.enabled", DEFAULTS["remind.enabled"]) }}>
        <Toggle label="Уведомления" on={enabled} onChange={(on) => p.onSet("remind.enabled", on ? "1" : "0")} />
      </Row>
      <fieldset disabled={!enabled} className="set-group">
        <Row name="Звук" def={{ text: DEFAULTS["remind.sound"], changed: sound !== DEFAULTS["remind.sound"], reset: () => p.onSet("remind.sound", DEFAULTS["remind.sound"]) }}>
          <select className="field set-select" value={sound} onChange={(e) => p.onSet("remind.sound", e.target.value)}>
            <option value="none">Без звука</option>
            {SOUNDS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Row>
        <Row name="Проверить" hint="Пришлёт пробное уведомление с выбранным звуком">
          <button type="button" className="btn" onClick={test}>Отправить</button>
        </Row>
        {tested && <div className="error">{tested}</div>}
        <Row name="Утренняя сводка" hint="Раз в день: сколько задач на сегодня и сколько ждут разбора"
          def={{ text: `${DEFAULTS["digest.enabled"] === "1" ? "включена" : "выключена"}, ${DEFAULTS["digest.time"]}`, changed: digestChanged,
            reset: () => (p.onSet("digest.enabled", DEFAULTS["digest.enabled"]), p.onSet("digest.time", DEFAULTS["digest.time"])) }}>
          <div className="seg">
            {digest && <TimeInput value={pref(p.settings, "digest.time")} onCommit={(t) => t && p.onSet("digest.time", t)} />}
            <Toggle label="Утренняя сводка" on={digest} onChange={(on) => p.onSet("digest.enabled", on ? "1" : "0")} />
          </div>
        </Row>
        <Row name="Дедлайны" hint="Предупредить, что срок задачи подходит. Приходит один раз на задачу"
          def={{ text: "за 1 день, 10:00", changed: dlChanged, reset: () => dlKeys.forEach((k) => p.onSet(k, DEFAULTS[k])) }}>
          <div className="seg">
            {dl.on && (
              <>
                <select className="field set-select" value={dl.days} aria-label="За сколько дней" onChange={(e) => p.onSet("deadline.days", e.target.value)}>
                  {DEADLINE_DAYS.map((n) => <option key={n} value={n}>{n === 0 ? "в тот же день" : `за ${plural(n, "день", "дня", "дней")}`}</option>)}
                </select>
                <TimeInput value={dl.time} onCommit={(t) => t && p.onSet("deadline.time", t)} />
              </>
            )}
            <Toggle label="Уведомления о дедлайнах" on={dl.on} onChange={(on) => p.onSet("deadline.notify", on ? "1" : "0")} />
          </div>
        </Row>
      </fieldset>
      <ResetSection name="Уведомления" changed={notifChanged} onReset={resetNotif} />
    </div>
  );
}

function MenuItems(p: SettingsProps) {
  const [picker, setPicker] = useState<{ id: ViewId; el: HTMLElement } | null>(null);
  const iconOf = (id: ViewId) => p.settings[`icon:${id}`] ?? VIEWS.find((v) => v.id === id)!.icon;
  const pickerView = picker && VIEWS.find((v) => v.id === picker.id);
  const menuChanged = (id: ViewId) => p.settings[`hidden:${id}`] === "1" || iconOf(id) !== VIEWS.find((v) => v.id === id)!.icon;
  const resetMenu = (id: ViewId) => {
    if (p.settings[`hidden:${id}`] === "1") p.onSet(`hidden:${id}`, "0");
    if (iconOf(id) !== VIEWS.find((v) => v.id === id)!.icon) p.onSet(`icon:${id}`, VIEWS.find((v) => v.id === id)!.icon);
  };
  return (
    <div className="set-group">
      <div className="hint">Какие списки показывать в меню слева и с какой иконкой. Иконку можно сменить и кликом по ней прямо в меню.</div>
      {/* Главная всегда в меню: она открывается по ⌘0 и при запуске, иконка у неё своя */}
      <div className="set-row menu-row">
        <span className="nav-icon big"><HomeIcon /></span>
        <div className="set-text">
          <div className="set-name">Главная</div>
          <div className="hint">Сводка дня, поэтому этот пункт всегда виден</div>
        </div>
        <Toggle label="Показывать «Главная»" on disabled onChange={() => {}} />
      </div>
      {VIEWS.map((v) => {
        const hidden = p.settings[`hidden:${v.id}`] === "1";
        return (
          <div key={v.id} className={`set-row menu-row ${hidden ? "off" : ""}`}>
            <button type="button" className="nav-icon big" title="Сменить иконку" style={{ color: `var(--${v.accent})` }}
              onClick={(e) => setPicker({ id: v.id, el: e.currentTarget })}>
              <Icon name={iconOf(v.id)} size={16} />
            </button>
            <div className="set-text">
              <div className="set-name">{v.name}</div>
              {v.id === "inbox" && <div className="hint">Сюда падают все новые задачи, поэтому этот список всегда виден</div>}
              <div className="set-def">
                По умолчанию: <b>виден, иконка</b> <Icon name={v.icon} size={13} />
                {menuChanged(v.id) && <button type="button" className="link" onClick={() => resetMenu(v.id)}>Сбросить</button>}
              </div>
            </div>
            <Toggle label={`Показывать «${v.name}»`} on={!hidden} disabled={v.id === "inbox"}
              onChange={(on) => p.onSet(`hidden:${v.id}`, on ? "0" : "1")} />
          </div>
        );
      })}
      <ResetSection name="Меню" changed={VIEWS.some((v) => menuChanged(v.id))} onReset={() => VIEWS.forEach((v) => resetMenu(v.id))} />
      {picker && pickerView && (
        <Popover anchor={picker.el} onClose={() => setPicker(null)} width={232}>
          <div className="lbl">Иконка для «{pickerView.name}»</div>
          <IconGrid value={iconOf(picker.id)} accent={pickerView.accent}
            onPick={(icon) => (p.onSet(`icon:${picker.id}`, icon), setPicker(null))} />
        </Popover>
      )}
    </div>
  );
}
