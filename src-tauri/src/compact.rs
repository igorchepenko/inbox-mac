//! Компактный вид: значок Inbox у правого края экрана и маленькое окно со списками рядом с ним.
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
//! - значок можно тащить вверх и вниз вдоль края, место и размер окна запоминаются в compact.json.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize};

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
struct Saved {
    /// Середина значка по высоте рабочей области экрана, от 0 (верх) до 1 (низ)
    y: f64,
    /// Размер окна `compact` в точках
    w: f64,
    h: f64,
    /// Показывать ли значок (галочка в меню строки меню)
    on: bool,
}

impl Default for Saved {
    fn default() -> Self {
        Saved {
            y: 0.45,
            w: 360.0,
            h: 480.0,
            on: true,
        }
    }
}

#[derive(PartialEq, Clone, Copy)]
enum Open {
    No,
    Hover,
    Pinned,
}

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
    was_pressed: bool,
    hover_since: Option<Instant>,
    away_since: Option<Instant>,
    hidden_at: Option<Instant>,
    /// Где сейчас значок, в пикселях экрана
    edge: Option<Rect>,
    scale: f64,
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
        was_pressed: false,
        hover_since: None,
        away_since: None,
        hidden_at: None,
        edge: None,
        scale: 1.0,
    })));
    place_edge(app, None);
    if on {
        show_edge(app);
    }
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(TICK);
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

/// Поставить значок к правому краю рабочей области главного экрана (без строки меню и Dock).
/// top — верх значка в пикселях при перетаскивании, иначе берём сохранённое место
fn place_edge(app: &AppHandle, top: Option<f64>) {
    let Some(w) = app.get_webview_window("edge") else {
        return;
    };
    let Ok(Some(m)) = app.primary_monitor() else {
        return;
    };
    let Some(st) = state(app) else { return };
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
    let x = ax + aw - ew;
    let rect = Rect { x, y, w: ew, h: eh };
    let changed = {
        let Ok(mut g) = st.0.lock() else { return };
        g.scale = scale;
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

/// Открыть окно слева от значка, по высоте напротив него, не вылезая за экран
fn show(app: &AppHandle, mode: Open) {
    let Some(w) = app.get_webview_window("compact") else {
        return;
    };
    let Some(st) = state(app) else { return };
    let (edge, scale) = {
        let Ok(g) = st.0.lock() else { return };
        (g.edge, g.scale)
    };
    let Some(edge) = edge else { return };
    if let (Ok(size), Ok(Some(m))) = (w.outer_size(), app.primary_monitor()) {
        let area = m.work_area();
        let (ay, ah) = (area.position.y as f64, area.size.height as f64);
        let (cw, ch) = (size.width as f64, size.height as f64);
        let pad = PAD * scale;
        let x = edge.x - cw + pad - GAP * scale;
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
    let _ = app.emit_to("compact", "compact-open", ());
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
    // Раз в пару секунд сверяем место значка с экраном: подключили монитор, переставили Dock
    static TICKS: AtomicU32 = AtomicU32::new(0);
    if TICKS.fetch_add(1, Ordering::Relaxed) % 40 == 39 {
        let idle =
            st.0.lock()
                .map(|g| g.drag.is_none() && g.saved.on)
                .unwrap_or(false);
        if idle {
            place_edge(app, None);
        }
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
        if let Some(mut d) = g.drag.take() {
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
        Act::Show(m) => show(app, m),
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
                Open::No => show(app, Open::Pinned),
            }
        }
        Act::MoveEdge(top) => {
            if open_now != Open::No {
                hide(app);
            }
            place_edge(app, Some(top));
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
