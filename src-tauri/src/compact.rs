//! Компактный вид: значок Inbox у края экрана и маленькое окно со списками рядом с ним.
//!
//! Два окна из tauri.conf.json: `edge` — сам значок (панель, которая не забирает клавиатуру у твоей программы)
//! и `compact` — окно со списками. Наведение, клик и перетаскивание значка ловит фоновый поток: раз в 60 мс
//! смотрит, где курсор и нажата ли кнопка мыши. Так не нужно, чтобы webview значка получал события мыши,
//! пока Inbox не активен, а macOS их неактивным окнам отдаёт не всегда.
//!
//! Правила:
//! - курсор задержался на значке → окно открывается «по наведению» и закрывается, когда курсор ушёл с значка и окна;
//! - клик по значку → окно открывается «закреплённым» и закрывается кликом мимо, Esc или повторным кликом по значку;
//! - пока в строке ввода фокус или набран текст, окно по уходу курсора не закрывается (compact_hold);
//! - значок можно тащить вверх и вниз вдоль края, место и размер окна запоминаются в compact.json;
//! - край (правый или левый) и монитор (основной или тот, где курсор) выбираются в настройках;
//! - своё глобальное сочетание (по умолчанию ⌥⇧Space) открывает окно без мыши: дальше стрелки и Enter (Compact.tsx).
//!
//! Настройки места и сочетания хранятся здесь же, в compact.json, а не в базе профиля: значок один на приложение
//! и нужен до того, как открылось хоть одно окно. Окно настроек читает и меняет их командами compact_prefs,
//! set_compact_place и set_compact_shortcut (обёртки в src/compactPrefs.ts), об изменениях все окна узнают
//! из события compact-prefs.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// Сочетание по умолчанию: рядом с ⌥Space быстрого ввода
pub const DEFAULT_KEY: &str = "Alt+Shift+Space";

/// Размер значка в точках экрана
const EDGE_W: f64 = 30.0;
const EDGE_H: f64 = 64.0;
/// Прозрачный отступ вокруг карточки в окне `compact`: там тень и ручки изменения размера (.cv-root в compact.css)
const PAD: f64 = 10.0;
/// Между карточкой и значком
const GAP: f64 = 2.0;
/// Сколько курсор должен постоять на значке, чтобы окно открылось само: проскочивший мимо курсор его не откроет
const HOVER_OPEN: Duration = Duration::from_millis(180);
/// Сколько курсор может быть вне значка и окна, прежде чем окно закроется: можно чуть промахнуться
const AWAY_CLOSE: Duration = Duration::from_millis(450);
/// Запас вокруг окна, где курсор ещё считается «внутри»
const SLACK: f64 = 6.0;
const TICK: Duration = Duration::from_millis(60);

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(default)]
struct Saved {
    /// Середина значка по высоте рабочей области экрана, от 0 (верх) до 1 (низ)
    y: f64,
    /// Размер окна `compact` в точках
    w: f64,
    h: f64,
    /// Показывать ли значок (галочка в меню строки меню)
    on: bool,
    /// К какому краю прижат значок: right или left
    side: String,
    /// На каком мониторе: main — основной, current — тот, где сейчас курсор
    screen: String,
    /// Сочетание, которое открывает окно, в формате «Alt+Shift+Space». Пустая строка — без сочетания
    key: String,
}

impl Default for Saved {
    fn default() -> Self {
        Saved {
            y: 0.45,
            w: 360.0,
            h: 480.0,
            on: true,
            side: "right".into(),
            screen: "main".into(),
            key: DEFAULT_KEY.into(),
        }
    }
}

impl Saved {
    fn left(&self) -> bool {
        self.side == "left"
    }
    fn current(&self) -> bool {
        self.screen == "current"
    }
}

/// Настройки компактного вида для окна настроек (src/compactPrefs.ts)
#[derive(serde::Serialize, Clone)]
pub struct Prefs {
    side: String,
    screen: String,
    key: String,
    /// Подпись сочетания для меню, «⌥⇧Space»
    label: String,
    /// Сочетание удалось занять
    key_ok: bool,
    /// Почему не удалось занять сохранённое сочетание
    key_error: Option<String>,
}

#[derive(PartialEq, Clone, Copy)]
enum Open {
    No,
    Hover,
    Pinned,
}

/// Растягивание окна за ручку: системное (startResizeDragging) на macOS не работает, двигаем окно сами
struct Resize {
    north: bool,
    south: bool,
    west: bool,
    east: bool,
    cursor: (f64, f64),
    rect: Rect,
}

/// Пока тянут ручку, поток проверяет курсор чаще, чтобы окно шло за мышью плавно
static RESIZING: AtomicBool = AtomicBool::new(false);
const MIN_W: f64 = 240.0;
const MIN_H: f64 = 220.0;

struct Drag {
    cursor_y: f64,
    win_y: i32,
    moved: bool,
}

#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    fn has(&self, px: f64, py: f64, slack: f64) -> bool {
        px >= self.x - slack
            && px <= self.x + self.w + slack
            && py >= self.y - slack
            && py <= self.y + self.h + slack
    }
}

struct Inner {
    saved: Saved,
    open: Open,
    hold: bool,
    drag: Option<Drag>,
    resize: Option<Resize>,
    was_pressed: bool,
    hover_since: Option<Instant>,
    away_since: Option<Instant>,
    hidden_at: Option<Instant>,
    /// Где сейчас значок, в пикселях экрана
    edge: Option<Rect>,
    /// Рабочая область монитора, на котором значок: туда же ставим окно
    area: Option<Rect>,
    scale: f64,
    /// Занятое сейчас сочетание компактного вида и ошибка, если занять не вышло
    key: Option<Shortcut>,
    key_error: Option<String>,
}

pub struct Compact(Mutex<Inner>);

fn file(app: &AppHandle) -> Option<PathBuf> {
    crate::data_dir(app).ok().map(|d| d.join("compact.json"))
}

fn load(app: &AppHandle) -> Saved {
    file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, s: &Saved) {
    let Some(p) = file(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(s) {
        let _ = std::fs::write(p, json);
    }
}

fn state(app: &AppHandle) -> Option<tauri::State<'_, Compact>> {
    app.try_state::<Compact>()
}

/// Включён ли значок: для галочки в меню строки меню
pub fn enabled(app: &AppHandle) -> bool {
    let Some(st) = state(app) else { return true };
    let on = st.0.lock().map(|g| g.saved.on).unwrap_or(true);
    on
}

/// Один раз при запуске (setup): прочитать настройки, поставить значок и запустить фоновый поток
pub fn setup(app: &AppHandle) {
    let saved = load(app);
    if let Some(w) = app.get_webview_window("compact") {
        let _ = w.set_size(LogicalSize::new(saved.w, saved.h));
    }
    if let Some(w) = app.get_webview_window("edge") {
        let _ = w.set_size(LogicalSize::new(EDGE_W, EDGE_H));
    }
    let on = saved.on;
    app.manage(Compact(Mutex::new(Inner {
        saved,
        open: Open::No,
        hold: false,
        drag: None,
        resize: None,
        was_pressed: false,
        hover_since: None,
        away_since: None,
        hidden_at: None,
        edge: None,
        area: None,
        scale: 1.0,
        key: None,
        key_error: None,
    })));
    let accel = load(app).key;
    if !accel.is_empty() {
        if let Err(e) = register(app, &accel) {
            eprintln!("Не удалось занять сочетание компактного вида {accel}: {e}");
            if let Some(st) = state(app) {
                if let Ok(mut g) = st.0.lock() {
                    g.key_error = Some(e);
                }
            }
        }
    }
    place_edge(app, None);
    if on {
        show_edge(app);
    }
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(if RESIZING.load(Ordering::Relaxed) {
            Duration::from_millis(16)
        } else {
            TICK
        });
        tick(&handle);
    });
}

fn show_edge(app: &AppHandle) {
    let Some(w) = app.get_webview_window("edge") else {
        return;
    };
    #[cfg(target_os = "macos")]
    {
        let panel = w.clone();
        let _ = w.run_on_main_thread(move || crate::quick_panel::show_passive(&panel));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = w.show();
}

/// Монитор, на котором точка (x, y) в пикселях экрана
fn monitor_at(app: &AppHandle, x: f64, y: f64) -> Option<tauri::Monitor> {
    app.available_monitors().ok()?.into_iter().find(|m| {
        let (p, s) = (m.position(), m.size());
        x >= p.x as f64
            && x < p.x as f64 + s.width as f64
            && y >= p.y as f64
            && y < p.y as f64 + s.height as f64
    })
}

/// Поставить значок к правому или левому краю рабочей области монитора (без строки меню и Dock).
/// top — верх значка в пикселях при перетаскивании, иначе берём сохранённое место
fn place_edge(app: &AppHandle, top: Option<f64>) {
    let Some(w) = app.get_webview_window("edge") else {
        return;
    };
    let Some(st) = state(app) else { return };
    let (left, current, edge) =
        st.0.lock()
            .map(|g| (g.saved.left(), g.saved.current(), g.edge))
            .unwrap_or((false, false, None));
    // Пока значок тащат, он остаётся на своём мониторе. «Текущий» монитор — тот, где курсор
    let here = if top.is_some() {
        edge.and_then(|r| monitor_at(app, r.x + r.w / 2.0, r.y + r.h / 2.0))
    } else if current {
        app.cursor_position()
            .ok()
            .and_then(|c| monitor_at(app, c.x, c.y))
    } else {
        None
    };
    let Some(m) = here.or_else(|| app.primary_monitor().ok().flatten()) else {
        return;
    };
    let scale = m.scale_factor();
    let area = m.work_area();
    let (ax, ay, aw, ah) = (
        area.position.x as f64,
        area.position.y as f64,
        area.size.width as f64,
        area.size.height as f64,
    );
    let (ew, eh) = (EDGE_W * scale, EDGE_H * scale);
    let frac = st.0.lock().map(|g| g.saved.y).unwrap_or(0.45);
    let y = top
        .unwrap_or(ay + frac * ah - eh / 2.0)
        .clamp(ay, (ay + ah - eh).max(ay));
    let x = if left { ax } else { ax + aw - ew };
    let rect = Rect { x, y, w: ew, h: eh };
    let changed = {
        let Ok(mut g) = st.0.lock() else { return };
        g.scale = scale;
        g.area = Some(Rect {
            x: ax,
            y: ay,
            w: aw,
            h: ah,
        });
        if top.is_some() && ah > eh {
            g.saved.y = ((y + eh / 2.0 - ay) / ah).clamp(0.0, 1.0);
        }
        let old = g.edge.replace(rect);
        old.map_or(true, |o| {
            (o.x - x).abs() > 0.5 || (o.y - y).abs() > 0.5 || (o.h - eh).abs() > 0.5
        })
    };
    if changed {
        let _ = w.set_size(PhysicalSize::new(ew.round() as u32, eh.round() as u32));
        let _ = w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    }
}

/// Открыть окно рядом со значком (со стороны экрана), по высоте напротив него, не вылезая за экран.
/// keys — открыли сочетанием: окно сразу ставит курсор на первую задачу для стрелок и Enter
fn show(app: &AppHandle, mode: Open, keys: bool) {
    let Some(w) = app.get_webview_window("compact") else {
        return;
    };
    let Some(st) = state(app) else { return };
    let (edge, area, scale, left) = {
        let Ok(g) = st.0.lock() else { return };
        (g.edge, g.area, g.scale, g.saved.left())
    };
    let (Some(edge), Some(area)) = (edge, area) else {
        return;
    };
    if let Ok(size) = w.outer_size() {
        let (ay, ah) = (area.y, area.h);
        let (cw, ch) = (size.width as f64, size.height as f64);
        let pad = PAD * scale;
        let x = if left {
            edge.x + edge.w - pad + GAP * scale
        } else {
            edge.x - cw + pad - GAP * scale
        };
        let y =
            (edge.y + edge.h / 2.0 - ch / 2.0).clamp(ay - pad, (ay + ah - ch + pad).max(ay - pad));
        let _ = w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    }
    if let Ok(mut g) = st.0.lock() {
        g.open = mode;
        g.away_since = None;
        g.hover_since = None;
    }
    // Список перечитывается при каждом открытии: задачи могли поменять в главном окне
    let _ = app.emit_to("compact", "compact-open", keys);
    #[cfg(target_os = "macos")]
    {
        let panel = w.clone();
        let _ = w.run_on_main_thread(move || crate::quick_panel::show(&panel));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.emit_to("edge", "edge-state", true);
}

/// Спрятать окно и запомнить его размер
pub fn hide(app: &AppHandle) {
    let Some(st) = state(app) else { return };
    let was = {
        let Ok(mut g) = st.0.lock() else { return };
        let was = g.open;
        g.open = Open::No;
        g.hold = false;
        g.away_since = None;
        g.hidden_at = Some(Instant::now());
        if was != Open::No {
            let s = g.saved.clone();
            drop(g);
            save(app, &s);
        }
        was
    };
    if was == Open::No {
        return;
    }
    if let Some(w) = app.get_webview_window("compact") {
        let _ = w.hide();
    }
    let _ = app.emit_to("compact", "compact-hidden", ());
    let _ = app.emit_to("edge", "edge-state", false);
}

/// Окно потеряло фокус: клик мимо. Пока тащат значок, не трогаем: окно и так спрячется
pub fn blurred(app: &AppHandle) {
    let Some(st) = state(app) else { return };
    let dragging = st.0.lock().map(|g| g.drag.is_some()).unwrap_or(false);
    if !dragging {
        hide(app);
    }
}

/// Окно растянули: запоминаем размер в точках, сохранится при закрытии
pub fn resized(app: &AppHandle, size: PhysicalSize<u32>, scale: f64) {
    let Some(st) = state(app) else { return };
    if let Ok(mut g) = st.0.lock() {
        if g.open != Open::No && scale > 0.0 {
            g.saved.w = size.width as f64 / scale;
            g.saved.h = size.height as f64 / scale;
        }
    };
}

/// Галочка «Значок у края экрана» в меню строки меню
pub fn set_enabled(app: &AppHandle, on: bool) {
    hide(app);
    let Some(st) = state(app) else { return };
    let s = {
        let Ok(mut g) = st.0.lock() else { return };
        g.saved.on = on;
        g.saved.clone()
    };
    save(app, &s);
    if on {
        place_edge(app, None);
        show_edge(app);
    } else if let Some(w) = app.get_webview_window("edge") {
        let _ = w.hide();
    }
}

enum Act {
    Resize(Rect),
    None,
    Show(Open),
    Hide,
    Toggle,
    MoveEdge(f64),
    Save,
}

fn pressed() -> bool {
    #[cfg(target_os = "macos")]
    return crate::quick_panel::left_pressed();
    #[cfg(not(target_os = "macos"))]
    false
}

fn tick(app: &AppHandle) {
    let Some(st) = state(app) else { return };
    // Раз в пару секунд сверяем место значка с экраном: подключили монитор, переставили Dock.
    // Если значок ходит за курсором по мониторам, сверяем чаще, но не пока окно открыто или значок тащат
    static TICKS: AtomicU32 = AtomicU32::new(0);
    let n = TICKS.fetch_add(1, Ordering::Relaxed);
    let (idle, follow) =
        st.0.lock()
            .map(|g| {
                (
                    g.drag.is_none() && g.resize.is_none() && g.saved.on,
                    g.saved.current() && g.open == Open::No,
                )
            })
            .unwrap_or((false, false));
    if idle && (n % 40 == 39 || (follow && n % 5 == 4)) {
        place_edge(app, None);
    }
    let Ok(cursor) = app.cursor_position() else {
        return;
    };
    let down = pressed();
    // Окно меряем до того, как взять замок: вызовы окна идут через главный поток, а он сам может ждать замок
    let open_now = st.0.lock().map(|g| g.open).unwrap_or(Open::No);
    let win = if open_now != Open::No {
        app.get_webview_window("compact")
            .and_then(|w| match (w.outer_position(), w.outer_size()) {
                (Ok(p), Ok(s)) => Some(Rect {
                    x: p.x as f64,
                    y: p.y as f64,
                    w: s.width as f64,
                    h: s.height as f64,
                }),
                _ => None,
            })
    } else {
        None
    };

    let act = {
        let Ok(mut g) = st.0.lock() else { return };
        if !g.saved.on {
            return;
        }
        let Some(edge) = g.edge else { return };
        let (scale, open, holding) = (g.scale, g.open, g.hold);
        let (cx, cy) = (cursor.x, cursor.y);
        let in_edge = edge.has(cx, cy, 0.0);
        // Окно целиком, с прозрачным отступом под ручки размера, и небольшой запас вокруг
        let in_win = win.is_some_and(|r| r.has(cx, cy, SLACK * scale));
        let just_pressed = down && !g.was_pressed;
        g.was_pressed = down;

        if just_pressed && in_edge {
            g.drag = Some(Drag {
                cursor_y: cy,
                win_y: edge.y as i32,
                moved: false,
            });
        }
        if let Some(r) = g.resize.as_ref() {
            if down {
                let (dx, dy) = (cx - r.cursor.0, cy - r.cursor.1);
                let (min_w, min_h) = (MIN_W * scale, MIN_H * scale);
                let mut n = r.rect;
                if r.west {
                    n.w = (r.rect.w - dx).max(min_w);
                    n.x = r.rect.x + r.rect.w - n.w;
                }
                if r.east {
                    n.w = (r.rect.w + dx).max(min_w);
                }
                if r.north {
                    n.h = (r.rect.h - dy).max(min_h);
                    n.y = r.rect.y + r.rect.h - n.h;
                }
                if r.south {
                    n.h = (r.rect.h + dy).max(min_h);
                }
                Act::Resize(n)
            } else {
                g.resize = None;
                RESIZING.store(false, Ordering::Relaxed);
                Act::None
            }
        } else if let Some(mut d) = g.drag.take() {
            if down {
                let dy = cy - d.cursor_y;
                if !d.moved && dy.abs() > 4.0 * scale {
                    d.moved = true;
                }
                let act = if d.moved {
                    Act::MoveEdge(d.win_y as f64 + dy)
                } else {
                    Act::None
                };
                g.drag = Some(d);
                act
            } else if d.moved {
                Act::Save
            } else {
                Act::Toggle
            }
        } else if down {
            // Кнопка зажата: тянут ручку размера или выделяют текст. Курсор может выйти за окно, не закрываем
            g.away_since = None;
            Act::None
        } else {
            match open {
                Open::No if in_edge => {
                    let since = *g.hover_since.get_or_insert_with(Instant::now);
                    if since.elapsed() >= HOVER_OPEN {
                        Act::Show(Open::Hover)
                    } else {
                        Act::None
                    }
                }
                Open::No => {
                    g.hover_since = None;
                    Act::None
                }
                Open::Hover if !holding => {
                    if in_edge || in_win {
                        g.away_since = None;
                        Act::None
                    } else {
                        let since = *g.away_since.get_or_insert_with(Instant::now);
                        if since.elapsed() >= AWAY_CLOSE {
                            Act::Hide
                        } else {
                            Act::None
                        }
                    }
                }
                _ => Act::None,
            }
        }
    };

    match act {
        Act::None => {}
        Act::Show(m) => show(app, m, false),
        Act::Hide => hide(app),
        Act::Toggle => {
            let (open, recently) =
                st.0.lock()
                    .map(|g| {
                        (
                            g.open,
                            g.hidden_at
                                .is_some_and(|t| t.elapsed() < Duration::from_millis(350)),
                        )
                    })
                    .unwrap_or((Open::No, false));
            match open {
                // Открыто наведением: клик закрепляет, окно больше не закроется само
                Open::Hover => {
                    if let Ok(mut g) = st.0.lock() {
                        g.open = Open::Pinned;
                    }
                }
                Open::Pinned => hide(app),
                // Только что закрылось от этого же клика (окно потеряло фокус): не открываем снова
                Open::No if recently => {}
                Open::No => show(app, Open::Pinned, false),
            }
        }
        Act::MoveEdge(top) => {
            if open_now != Open::No {
                hide(app);
            }
            place_edge(app, Some(top));
        }
        Act::Resize(r) => {
            if let Some(w) = app.get_webview_window("compact") {
                let _ = w.set_size(PhysicalSize::new(r.w.round() as u32, r.h.round() as u32));
                let _ = w.set_position(PhysicalPosition::new(
                    r.x.round() as i32,
                    r.y.round() as i32,
                ));
            }
        }
        Act::Save => {
            let s = st.0.lock().ok().map(|g| g.saved.clone());
            if let Some(s) = s {
                save(app, &s);
            }
        }
    }
}

/// Строка ввода в фокусе или в ней есть текст: окно по уходу курсора не закрываем
#[tauri::command]
pub fn compact_hold(app: AppHandle, on: bool) {
    if let Some(st) = state(&app) {
        if let Ok(mut g) = st.0.lock() {
            g.hold = on;
            g.away_since = None;
        }
    }
}

/// Нажали на ручку размера: dir — n, s, w, e, nw, sw, ne или se (у левого края экрана ручки справа). Дальше окно за мышью ведёт фоновый поток, пока кнопка зажата
#[tauri::command]
pub fn compact_resize(app: AppHandle, dir: String) {
    let Some(w) = app.get_webview_window("compact") else {
        return;
    };
    let (Ok(p), Ok(size), Ok(c)) = (w.outer_position(), w.outer_size(), app.cursor_position())
    else {
        return;
    };
    let Some(st) = state(&app) else { return };
    if let Ok(mut g) = st.0.lock() {
        g.resize = Some(Resize {
            north: dir.contains('n'),
            south: dir.contains('s'),
            west: dir.contains('w'),
            east: dir.contains('e'),
            cursor: (c.x, c.y),
            rect: Rect {
                x: p.x as f64,
                y: p.y as f64,
                w: size.width as f64,
                h: size.height as f64,
            },
        });
        g.away_since = None;
        RESIZING.store(true, Ordering::Relaxed);
    };
}

/// Esc в окне
#[tauri::command]
pub fn compact_hide(app: AppHandle) {
    hide(&app);
}

/// Клик по задаче: открыть её в главном окне
#[tauri::command]
pub fn compact_open_task(app: AppHandle, id: i64) {
    hide(&app);
    crate::show_main(&app);
    let _ = app.emit_to("main", "open-task", id);
}

// ── Сочетание клавиш и место значка ──

/// «Alt+Shift+Space» → «⌥⇧Space», как labelFromAccel в src/prefs.ts
pub fn label(accel: &str) -> String {
    if accel.is_empty() {
        return String::new();
    }
    let parts: Vec<&str> = accel.split('+').collect();
    let has = |m: &[&str]| {
        parts
            .iter()
            .any(|p| m.iter().any(|x| p.eq_ignore_ascii_case(x)))
    };
    let mut out = String::new();
    if has(&["Control", "Ctrl"]) {
        out.push('⌃');
    }
    if has(&["Alt", "Option"]) {
        out.push('⌥');
    }
    if has(&["Shift"]) {
        out.push('⇧');
    }
    if has(&["Super", "Cmd", "Command", "Meta"]) {
        out.push('⌘');
    }
    let code = parts.last().copied().unwrap_or("");
    let key = match code {
        "Enter" => "↩",
        "Tab" => "⇥",
        "Backspace" => "⌫",
        "Escape" => "Esc",
        "ArrowUp" => "↑",
        "ArrowDown" => "↓",
        "ArrowLeft" => "←",
        "ArrowRight" => "→",
        c => c
            .strip_prefix("Key")
            .or_else(|| c.strip_prefix("Digit"))
            .unwrap_or(c),
    };
    out.push_str(key);
    out
}

/// Занять сочетание вместо прежнего. Не вышло — прежнее остаётся, возвращаем причину
fn register(app: &AppHandle, accel: &str) -> Result<(), String> {
    let next: Shortcut = accel
        .parse()
        .map_err(|e| format!("Не получилось разобрать сочетание: {e}"))?;
    let quick = app
        .try_state::<crate::QuickKey>()
        .and_then(|k| k.0.lock().ok().map(|k| *k));
    if quick == Some(next) {
        return Err("Это сочетание уже открывает быстрый ввод".into());
    }
    let Some(st) = state(app) else {
        return Err("Компактный вид ещё не готов".into());
    };
    let old = st.0.lock().ok().and_then(|g| g.key);
    let gs = app.global_shortcut();
    if old == Some(next) && gs.is_registered(next) {
        return Ok(());
    }
    if let Some(o) = old {
        let _ = gs.unregister(o);
    }
    if let Err(e) = gs.register(next) {
        if let Some(o) = old {
            let _ = gs.register(o);
        }
        return Err(format!(
            "Сочетание занято системой или другим приложением ({e})"
        ));
    }
    if let Ok(mut g) = st.0.lock() {
        g.key = Some(next);
        g.key_error = None;
    }
    Ok(())
}

/// Это сочетание компактного вида? Для общего обработчика сочетаний в lib.rs
pub fn is_key(app: &AppHandle, s: &Shortcut) -> bool {
    key(app).is_some_and(|k| k == *s)
}

/// Занятое сейчас сочетание компактного вида
pub fn key(app: &AppHandle) -> Option<Shortcut> {
    state(app).and_then(|st| st.0.lock().ok().and_then(|g| g.key))
}

/// Нажали сочетание: открыть окно с клавиатурой или спрятать, если уже открыто
pub fn toggle_from_key(app: &AppHandle) {
    let Some(st) = state(app) else { return };
    let open = st.0.lock().map(|g| g.open).unwrap_or(Open::No);
    if open != Open::No {
        hide(app);
        return;
    }
    // Значок на «текущем» мониторе мог ещё не дойти за курсором: ставим сразу
    place_edge(app, None);
    show(app, Open::Pinned, true);
}

fn prefs(app: &AppHandle) -> Prefs {
    let Some(st) = state(app) else {
        let s = Saved::default();
        return Prefs {
            label: label(&s.key),
            side: s.side,
            screen: s.screen,
            key: s.key,
            key_ok: false,
            key_error: None,
        };
    };
    let (s, key, err) =
        st.0.lock()
            .map(|g| (g.saved.clone(), g.key, g.key_error.clone()))
            .unwrap_or((Saved::default(), None, None));
    let key_ok = !s.key.is_empty() && key.is_some_and(|k| app.global_shortcut().is_registered(k));
    Prefs {
        label: label(&s.key),
        side: s.side,
        screen: s.screen,
        key: s.key,
        key_ok,
        key_error: err,
    }
}

/// Сообщить всем окнам новые настройки: значок меняет сторону, окно настроек — подписи
fn announce(app: &AppHandle) -> Prefs {
    let p = prefs(app);
    let _ = app.emit("compact-prefs", p.clone());
    if let Some(t) = app.try_state::<crate::TrayCompactItem>() {
        let _ = t.0.set_text(tray_text(&p.label));
    }
    p
}

/// Подпись пункта «Компактный вид» в меню строки меню
pub fn tray_text(label: &str) -> String {
    if label.is_empty() {
        "Компактный вид".into()
    } else {
        format!("Компактный вид    {label}")
    }
}

/// Подпись сочетания для меню строки меню при запуске
pub fn current_label(app: &AppHandle) -> String {
    prefs(app).label
}

/// Настройки компактного вида: край, монитор, сочетание и занято ли оно
#[tauri::command]
pub fn compact_prefs(app: AppHandle) -> Prefs {
    prefs(&app)
}

/// Край экрана (right, left) и монитор (main, current) для значка
#[tauri::command]
pub fn set_compact_place(app: AppHandle, side: String, screen: String) -> Result<Prefs, String> {
    if side != "right" && side != "left" {
        return Err(format!("Неизвестный край: {side}"));
    }
    if screen != "main" && screen != "current" {
        return Err(format!("Неизвестный монитор: {screen}"));
    }
    hide(&app);
    let Some(st) = state(&app) else {
        return Err("Компактный вид ещё не готов".into());
    };
    let s = {
        let mut g = st.0.lock().map_err(|e| e.to_string())?;
        g.saved.side = side;
        g.saved.screen = screen;
        // Сторона или монитор сменились: ставим значок заново, даже если пиксели совпали
        g.edge = None;
        g.saved.clone()
    };
    save(&app, &s);
    place_edge(&app, None);
    Ok(announce(&app))
}

/// Сменить сочетание, которое открывает компактный вид. accel в формате «Alt+Shift+KeyI»,
/// пустая строка — убрать сочетание. Если сочетание занято, оставляем прежнее и возвращаем ошибку
#[tauri::command]
pub fn set_compact_shortcut(app: AppHandle, accel: String) -> Result<Prefs, String> {
    let Some(st) = state(&app) else {
        return Err("Компактный вид ещё не готов".into());
    };
    if accel.is_empty() {
        let old = st.0.lock().ok().and_then(|mut g| {
            g.key_error = None;
            g.key.take()
        });
        if let Some(o) = old {
            let _ = app.global_shortcut().unregister(o);
        }
    } else {
        register(&app, &accel)?;
    }
    let s = {
        let mut g = st.0.lock().map_err(|e| e.to_string())?;
        g.saved.key = accel;
        g.saved.clone()
    };
    save(&app, &s);
    Ok(announce(&app))
}

/// Пункт «Компактный вид» в меню строки меню: открыть окно у значка
pub fn toggle_from_menu(app: &AppHandle) {
    toggle_from_key(app);
}
