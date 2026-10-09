import { useEffect, useRef, useState, type ReactNode } from "react";
import { BellRing, Keyboard, LayoutDashboard, PanelLeft, SlidersHorizontal, Type, X, type LucideIcon } from "lucide-react";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { Icon } from "./icons";
import { VIEWS, type ViewId } from "./views";
import { IconGrid, Popover, ThemeSwitch, TimeInput } from "./widgets";
import { HomeSettings } from "./HomeSettings";
import { ensurePermission, notify } from "./reminders";
import {
  accelFromEvent, DEFAULTS, FONTS, labelFromAccel, pref, savedAppearance, setAppearance, SIZES, SOUNDS, type Appearance,
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

function Row(props: { name: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-name">{props.name}</div>
        {props.hint && <div className="hint">{props.hint}</div>}
      </div>
      <div className="set-ctl">{props.children}</div>
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
  return (
    <div className="set-group">
      <Row name="Начальный экран" hint="Что открыто при запуске">
        <Choice value={pref(p.settings, "start.view")} onPick={(v) => p.onSet("start.view", v)}
          options={[
            ...visible.filter((v) => v.id !== "archive").map((v) => ({ id: v.id as string, name: v.name })),
            { id: "last", name: "Где остановился" },
          ]} />
      </Row>
      <Row name="Открывать при входе в систему"
        hint="Inbox запустится сам после включения Мака, и быстрый ввод с напоминаниями будут работать сразу">
        <Toggle label="Открывать при входе" on={!!autostart} disabled={autostart === null} onChange={toggleAutostart} />
      </Row>
    </div>
  );
}

function Look() {
  const [a, setA] = useState<Appearance>(savedAppearance());
  const set = (next: Appearance) => (setA(next), setAppearance(next));
  return (
    <div className="set-group">
      <Row name="Тема" hint="Быстрый переключатель остаётся и внизу меню слева">
        <ThemeSwitch wide />
      </Row>
      <Row name="Шрифт">
        <div className="seg">
          {FONTS.map((f) => (
            <button type="button" key={f.id} className={`font-card ${a.font === f.id ? "on" : ""}`} onClick={() => set({ ...a, font: f.id })}>
              <span className="font-sample" style={{ fontFamily: f.stack }}>Аа</span>
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row name="Размер" hint="Меняет масштаб всего окна: текст, отступы и иконки вместе">
        <Choice value={a.size} onPick={(size) => set({ ...a, size })} options={SIZES.map((s) => ({ id: s.id, name: s.name }))} />
      </Row>
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
        hint="Открывает карточку «Что нужно сделать?» поверх любого приложения. Нажми на поле и затем нужные клавиши">
        <button type="button" className={`key-rec ${recording ? "rec" : ""}`} disabled={busy}
          onClick={() => (setError(null), setRecording(!recording))}>
          {recording ? "Нажми сочетание…" : labelFromAccel(current)}
        </button>
      </Row>
      {shownError && <div className="error">{shownError}</div>}
      {current !== DEFAULTS["quick.shortcut"] && (
        <Row name="Вернуть как было" hint={`Стандартное сочетание ${labelFromAccel(DEFAULTS["quick.shortcut"])}`}>
          <button type="button" className="btn" onClick={() => apply(DEFAULTS["quick.shortcut"])}>Сбросить</button>
        </Row>
      )}
      <Row name="Без клавиатуры" hint="Карточка открывается и кликом по иконке Inbox в строке меню">
        <span />
      </Row>
    </div>
  );
}

function Notifications(p: SettingsProps) {
  const enabled = pref(p.settings, "remind.enabled") === "1";
  const sound = pref(p.settings, "remind.sound");
  const digest = pref(p.settings, "digest.enabled") === "1";
  const [tested, setTested] = useState<string | null>(null);
  const test = async () => {
    if (!(await ensurePermission())) return setTested("macOS не дал разрешения. Включи уведомления для Inbox в Системных настройках → Уведомления");
    notify(p.settings, "Проверка уведомлений", "Так будут выглядеть напоминания Inbox");
    setTested(null);
  };
  return (
    <div className="set-group">
      <Row name="Уведомления" hint="Когда выключены, напоминания проходят молча, а задачи остаются на своих местах">
        <Toggle label="Уведомления" on={enabled} onChange={(on) => p.onSet("remind.enabled", on ? "1" : "0")} />
      </Row>
      <fieldset disabled={!enabled} className="set-group">
        <Row name="Звук">
          <select className="field set-select" value={sound} onChange={(e) => p.onSet("remind.sound", e.target.value)}>
            <option value="none">Без звука</option>
            {SOUNDS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Row>
        <Row name="Проверить" hint="Пришлёт пробное уведомление с выбранным звуком">
          <button type="button" className="btn" onClick={test}>Отправить</button>
        </Row>
        {tested && <div className="error">{tested}</div>}
        <Row name="Утренняя сводка" hint="Раз в день: сколько задач на сегодня и сколько ждут разбора">
          <div className="seg">
            {digest && <TimeInput value={pref(p.settings, "digest.time")} onCommit={(t) => t && p.onSet("digest.time", t)} />}
            <Toggle label="Утренняя сводка" on={digest} onChange={(on) => p.onSet("digest.enabled", on ? "1" : "0")} />
          </div>
        </Row>
      </fieldset>
    </div>
  );
}

function MenuItems(p: SettingsProps) {
  const [picker, setPicker] = useState<{ id: ViewId; el: HTMLElement } | null>(null);
  const iconOf = (id: ViewId) => p.settings[`icon:${id}`] ?? VIEWS.find((v) => v.id === id)!.icon;
  const pickerView = picker && VIEWS.find((v) => v.id === picker.id);
  return (
    <div className="set-group">
      <div className="hint">Какие списки показывать в меню слева и с какой иконкой. Иконку можно сменить и кликом по ней прямо в меню.</div>
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
            </div>
            <Toggle label={`Показывать «${v.name}»`} on={!hidden} disabled={v.id === "inbox"}
              onChange={(on) => p.onSet(`hidden:${v.id}`, on ? "0" : "1")} />
          </div>
        );
      })}
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
