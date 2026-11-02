mod notify;

use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent, Wry,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_sql::{Migration, MigrationKind};

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Профили: список лежит в profiles.json рядом с базами. У каждого своя база, свои вложения и свои настройки.
/// Движок миграций (tauri-plugin-sql) принимает файлы баз только при старте, поэтому файлов заранее
/// заведено десять: два прежних, «test» и «igor», и восемь запасных p1…p8 для новых профилей.
/// У «test» база и папка вложений прежние, поэтому всё, что было до профилей, осталось в нём без переноса
const LEGACY: &[(&str, &str)] = &[("test", "Тест"), ("igor", "Игорь")];
const SLOTS: &[&str] = &["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
const NAME_MAX: usize = 40;

fn all_ids() -> impl Iterator<Item = &'static str> {
    LEGACY
        .iter()
        .map(|(id, _)| *id)
        .chain(SLOTS.iter().copied())
}

/// Файл базы в ~/Library/Application Support/com.igorchepenko.inbox
fn db_file(id: &str) -> String {
    match id {
        "test" => "inbox.db".into(),
        "igor" => "inbox-igor.db".into(),
        _ => format!("inbox-{id}.db"),
    }
}

/// Папка вложений внутри attachments: у «test» пустая, файлы лежат как раньше
fn files_sub(id: &str) -> String {
    if id == "test" {
        String::new()
    } else {
        id.to_string()
    }
}

fn db_url(id: &str) -> String {
    format!("sqlite:{}", db_file(id))
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Entry {
    id: String,
    name: String,
}

/// Список профилей. Меняется только командами ниже и сразу пишется в profiles.json
struct Registry(Mutex<Vec<Entry>>);

/// Сколько копий базы хранить на профиль: старые удаляются
const KEEP_BACKUPS: usize = 10;

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("profiles.json"))
}

/// Читает список. Первый запуск с профилями: заводит записи для баз, что уже лежат на диске
/// (прежние «Тест» и «Игорь»), так что при обновлении ничего не переносится и не теряется.
/// Чистая установка даёт пустой список, и приложение предлагает создать профиль
fn load_registry(app: &AppHandle) -> Vec<Entry> {
    let dir = data_dir(app).ok();
    if let Some(list) = registry_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Vec<Entry>>(&t).ok())
    {
        return list;
    }
    let seeded: Vec<Entry> = LEGACY
        .iter()
        .filter(|(id, _)| dir.as_ref().is_some_and(|d| d.join(db_file(id)).exists()))
        .map(|(id, name)| Entry {
            id: id.to_string(),
            name: name.to_string(),
        })
        .collect();
    let _ = save_registry(app, &seeded);
    seeded
}

fn save_registry(app: &AppHandle, list: &[Entry]) -> Result<(), String> {
    let path = registry_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn entry(app: &AppHandle, id: &str) -> Result<Entry, String> {
    app.state::<Registry>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .find(|e| e.id == id)
        .cloned()
        .ok_or_else(|| format!("Нет профиля {id}"))
}

/// Активный профиль (id, пусто, пока нет ни одного). Выбор хранит интерфейс (localStorage)
/// и сообщает сюда при каждой загрузке окна
struct ActiveProfile(Mutex<String>);

fn active_id(app: &AppHandle) -> String {
    app.state::<ActiveProfile>()
        .0
        .lock()
        .map(|a| a.clone())
        .unwrap_or_default()
}

/// Профили, у которых в этом запуске уже проверили копию базы
static BACKED_UP: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Подменю «Профиль» в меню строки меню: пункты пересобираются при любых изменениях списка, галочка у активного
struct TrayProfiles {
    sub: Submenu<Wry>,
    items: Mutex<Vec<(String, CheckMenuItem<Wry>)>>,
}

/// Ошибка, с которой не удалось занять сочетание быстрого ввода. Главное окно показывает её плашкой
static QUICK_ERROR: Mutex<Option<String>> = Mutex::new(None);

/// Идёт проверка сочетания в настройках: нажатие не открывает карточку, а сообщает главному окну, что дошло
/// Пока в быстром вводе открыт выбор файлов, потеря фокуса не прячет окно и не сбрасывает форму
static QUICK_PICKING: AtomicBool = AtomicBool::new(false);
static TESTING_QUICK: AtomicBool = AtomicBool::new(false);

/// Приложения, которые по умолчанию тоже слушают ⌥Space. macOS разрешает нескольким приложениям
/// занять одно сочетание без ошибки, и нажатие получает только одно из них
const ALT_SPACE_APPS: &[(&str, &str)] = &[
    ("/ChatGPT.app/", "ChatGPT"),
    ("/Claude.app/", "Claude"),
    ("/Raycast.app/", "Raycast"),
    ("/Alfred", "Alfred"),
    ("/Perplexity.app/", "Perplexity"),
];

/// Текущее сочетание быстрого ввода. Меняется в настройках, по умолчанию ⌥Space
struct QuickKey(Mutex<Shortcut>);

/// Пункт «Записать задачу» в меню строки меню: в нём подписано текущее сочетание
struct TrayQuickItem(MenuItem<Wry>);

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create projects and tasks",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "project description and icon, settings",
            sql: include_str!("../migrations/002_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "separate palette for projects",
            sql: include_str!("../migrations/003_project_palette.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "time range, eisenhower, recurrence, subtasks, links, attachments",
            sql: include_str!("../migrations/004_task_extras.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "five priority levels",
            sql: include_str!("../migrations/005_priority_levels.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "32-color project palette",
            sql: include_str!("../migrations/006_project_palette_32.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "kanban stage: started_at",
            sql: include_str!("../migrations/007_task_started.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "tags and assigned_by",
            sql: include_str!("../migrations/008_tags_assignee.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "task deadline",
            sql: include_str!("../migrations/009_deadline.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "reminder offset, meeting kind, deadline into date",
            sql: include_str!("../migrations/010_remind_kind.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "meeting participants",
            sql: include_str!("../migrations/011_task_people.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "cancelled status and summary",
            sql: include_str!("../migrations/012_cancel_summary.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "waiting status",
            sql: include_str!("../migrations/013_waiting.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "people directory",
            sql: include_str!("../migrations/014_people.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "task relations",
            sql: include_str!("../migrations/015_task_relations.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "people name parts",
            sql: include_str!("../migrations/016_people_name_parts.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// Окно быстрого ввода: показать поверх всех приложений или спрятать, если уже открыто.
/// На macOS это панель, которая не делает Inbox активным: ты остаёшься в своей программе и на своём столе,
/// главное окно не выскакивает (quick_panel ниже)
fn toggle_quick(app: &AppHandle) {
    let Some(w) = app.get_webview_window("quick") else {
        return;
    };
    if w.is_visible().unwrap_or(false) {
        hide_quick(app.clone());
        return;
    }
    place_quick(&w);
    #[cfg(target_os = "macos")]
    {
        let panel = w.clone();
        let _ = w.run_on_main_thread(move || quick_panel::show(&panel));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = w.show();
        let _ = w.set_focus();
    }
    // Окно ставит курсор в название и перечитывает пространства и теги
    let _ = app.emit_to("quick", "quick-open", ());
}

/// Как Spotlight: по центру по горизонтали, карточка на той же высоте, что у окна «Новая задача» по N в главном окне
/// (5% высоты, `.overlay:has(> .qi)` в styles.css): верх карточки на двадцатой части высоты экрана без Dock и строки меню.
/// Окно растёт вниз под длину формы, поэтому по центру по вертикали его не ставим: длинная форма уходила под Dock.
/// Сколько можно расти вниз, считает само окно (Quick.tsx, maxHeight)
fn place_quick(w: &tauri::WebviewWindow) {
    let (Ok(Some(m)), Ok(size)) = (w.current_monitor(), w.outer_size()) else {
        let _ = w.center();
        return;
    };
    let area = m.work_area();
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    // Вокруг карточки в окне 14 px отступа (.quick-root, место под крестик), их вычитаем, чтобы сама карточка встала на 5%
    let pad = (14.0 * m.scale_factor()) as i32;
    let y = area.position.y + area.size.height as i32 / 20 - pad;
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
}

#[tauri::command]
fn quick_picking(on: bool) {
    QUICK_PICKING.store(on, Ordering::SeqCst);
}

/// Спрятать быстрый ввод после сохранения, по Esc или повторному сочетанию.
/// Каждый раз окно открывается чистым и свёрнутым, поэтому форму сбрасываем сразу при закрытии
#[tauri::command]
fn hide_quick(app: AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        let _ = w.hide();
    }
    let _ = app.emit_to("quick", "quick-reset", ());
}

/// Быстрый ввод как у Spotlight: NSPanel с флагом «не активировать приложение».
/// Обычное окно при показе активирует всё приложение: macOS поднимает главное окно Inbox поверх твоей программы
/// и может перебросить на стол, где оно открыто. Панель получает клавиатуру, не трогая остальное
#[cfg(target_os = "macos")]
mod quick_panel {
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::{msg_send, sel};

    const NONACTIVATING_PANEL: usize = 1 << 7;
    const JOIN_ALL_SPACES: usize = 1 << 0;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;

    extern "C-unwind" fn yes(_: &AnyObject, _: Sel) -> Bool {
        Bool::YES
    }
    extern "C-unwind" fn no(_: &AnyObject, _: Sel) -> Bool {
        Bool::NO
    }

    /// Подкласс NSPanel: окно без рамки по умолчанию не может стать ключевым, а нам нужен ввод с клавиатуры
    fn class() -> &'static AnyClass {
        if let Some(cls) = AnyClass::get(c"InboxQuickPanel") {
            return cls;
        }
        let panel = AnyClass::get(c"NSPanel").expect("NSPanel есть в AppKit");
        let mut b = ClassBuilder::new(c"InboxQuickPanel", panel)
            .expect("класс InboxQuickPanel ещё не создан");
        unsafe {
            b.add_method(
                sel!(canBecomeKeyWindow),
                yes as extern "C-unwind" fn(_, _) -> _,
            );
            b.add_method(
                sel!(canBecomeMainWindow),
                no as extern "C-unwind" fn(_, _) -> _,
            );
        }
        b.register()
    }

    fn ns_window(w: &tauri::WebviewWindow) -> Option<&AnyObject> {
        let ptr = w.ns_window().ok()? as *mut AnyObject;
        unsafe { ptr.as_ref() }
    }

    /// Превратить окно quick в панель. Один раз при запуске, на главном потоке (setup)
    pub fn convert(w: &tauri::WebviewWindow) {
        let Some(win) = ns_window(w) else { return };
        unsafe {
            objc2::ffi::object_setClass(win as *const AnyObject as *mut AnyObject, class());
            let mask: usize = msg_send![win, styleMask];
            let _: () = msg_send![win, setStyleMask: mask | NONACTIVATING_PANEL];
            let behavior: usize = msg_send![win, collectionBehavior];
            let _: () = msg_send![win, setCollectionBehavior: behavior | JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY];
            let _: () = msg_send![win, setFloatingPanel: true];
            // Прячем сами, когда фокус ушёл (on_window_event): панель не должна исчезать по своим правилам
            let _: () = msg_send![win, setHidesOnDeactivate: false];
            let _: () = msg_send![win, setBecomesKeyOnlyIfNeeded: false];
        }
    }

    /// Показать и отдать клавиатуру, не активируя Inbox
    pub fn show(w: &tauri::WebviewWindow) {
        let Some(win) = ns_window(w) else { return };
        unsafe {
            let _: () = msg_send![win, makeKeyAndOrderFront: None::<&AnyObject>];
            let _: () = msg_send![win, orderFrontRegardless];
        }
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // Туда же tauri-plugin-sql кладёт базы: ~/Library/Application Support/com.igorchepenko.inbox
    app.path().app_config_dir().map_err(|e| e.to_string())
}

fn backups_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("backups").join(id))
}

/// Копия базы перед миграциями. Миграции приходят только с новой сборкой, поэтому копию делаем
/// при первом открытии базы в каждой новой версии приложения, до того как плагин её тронет.
/// Не получилось скопировать: базу не открываем, лучше ошибка на экране, чем миграция без копии
fn backup_before_migrations(app: &AppHandle, id: &str) -> Result<(), String> {
    let db = data_dir(app)?.join(db_file(id));
    let dir = backups_dir(app, id)?;
    let marker = dir.join("version");
    let version = app.package_info().version.to_string();
    let last = std::fs::read_to_string(&marker).unwrap_or_default();
    if last.trim() == version {
        return Ok(());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if db.exists() {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let from = if last.trim().is_empty() {
            "old"
        } else {
            last.trim()
        };
        let stem = db
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let name = format!("{stem}-{from}-{secs}.db");
        // База в режиме WAL держит свежие записи рядом, в -wal: копируем вместе
        for ext in ["", "-wal", "-shm"] {
            let src = PathBuf::from(format!("{}{ext}", db.to_string_lossy()));
            if src.exists() {
                std::fs::copy(&src, dir.join(format!("{name}{ext}")))
                    .map_err(|e| format!("Не удалось сделать копию базы перед обновлением: {e}"))?;
            }
        }
        prune_backups(&dir);
    }
    std::fs::write(&marker, &version).map_err(|e| e.to_string())
}

/// Оставляет KEEP_BACKUPS последних копий
fn prune_backups(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut dbs: Vec<(std::time::SystemTime, PathBuf)> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "db"))
        .map(|p| {
            (
                std::fs::metadata(&p)
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::UNIX_EPOCH),
                p,
            )
        })
        .collect();
    dbs.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, p) in dbs.into_iter().skip(KEEP_BACKUPS) {
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", p.to_string_lossy()));
        }
    }
}

fn mark_tray_profile(app: &AppHandle, id: &str) {
    if let Some(t) = app.try_state::<TrayProfiles>() {
        if let Ok(items) = t.items.lock() {
            for (pid, item) in items.iter() {
                let _ = item.set_checked(pid == id);
            }
        }
    }
    if let Some(tray) = app.tray_by_id("tray") {
        let tip = match entry(app, id) {
            Ok(e) => format!("Inbox · {}", e.name),
            Err(_) => "Inbox".to_string(),
        };
        let _ = tray.set_tooltip(Some(tip));
    }
}

/// Пересобирает пункты профилей в меню строки меню по текущему списку
fn rebuild_tray_profiles(app: &AppHandle) -> tauri::Result<()> {
    let Some(t) = app.try_state::<TrayProfiles>() else {
        return Ok(());
    };
    let list = app
        .state::<Registry>()
        .0
        .lock()
        .map(|l| l.clone())
        .unwrap_or_default();
    for item in t.sub.items()? {
        t.sub.remove(&item)?;
    }
    let mut built = Vec::new();
    for e in list {
        let item = CheckMenuItem::with_id(
            app,
            format!("profile:{}", e.id),
            &e.name,
            true,
            false,
            None::<&str>,
        )?;
        t.sub.append(&item)?;
        built.push((e.id, item));
    }
    if let Ok(mut items) = t.items.lock() {
        *items = built;
    }
    mark_tray_profile(app, &active_id(app));
    Ok(())
}

/// Список изменился: пересобрать меню и сообщить окнам
fn profiles_changed(app: &AppHandle) {
    let _ = rebuild_tray_profiles(app);
    let _ = app.emit("profiles-changed", ());
}

fn clean_name(name: &str, list: &[Entry], except: Option<&str>) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("У профиля должно быть название".into());
    }
    if name.chars().count() > NAME_MAX {
        return Err(format!("Название длиннее {NAME_MAX} символов"));
    }
    let low = name.to_lowercase();
    if list
        .iter()
        .any(|e| Some(e.id.as_str()) != except && e.name.to_lowercase() == low)
    {
        return Err("Профиль с таким названием уже есть".into());
    }
    Ok(name)
}

#[tauri::command]
fn list_profiles(reg: State<'_, Registry>) -> Result<Vec<Entry>, String> {
    Ok(reg.0.lock().map_err(|e| e.to_string())?.clone())
}

/// Адрес базы профиля: по нему окно закрывает базу перед удалением профиля
#[tauri::command]
fn profile_url(app: AppHandle, id: String) -> Result<String, String> {
    entry(&app, &id).map(|e| db_url(&e.id))
}

/// Новый профиль: берёт свободный запасной файл базы. Название и есть имя профиля
#[tauri::command]
fn create_profile(app: AppHandle, reg: State<'_, Registry>, name: String) -> Result<Entry, String> {
    let created = {
        let mut list = reg.0.lock().map_err(|e| e.to_string())?;
        let name = clean_name(&name, &list, None)?;
        let dir = data_dir(&app)?;
        let id = SLOTS
            .iter()
            .find(|s| !list.iter().any(|e| e.id == **s) && !dir.join(db_file(s)).exists())
            .ok_or("Больше восьми новых профилей завести нельзя. Удали ненужный")?;
        let e = Entry {
            id: id.to_string(),
            name,
        };
        list.push(e.clone());
        save_registry(&app, &list)?;
        e
    };
    profiles_changed(&app);
    Ok(created)
}

/// Порядок профилей: список id в новом порядке. Профили не добавляются и не пропадают, только переставляются
#[tauri::command]
fn reorder_profiles(
    app: AppHandle,
    reg: State<'_, Registry>,
    ids: Vec<String>,
) -> Result<(), String> {
    {
        let mut list = reg.0.lock().map_err(|e| e.to_string())?;
        let mut next: Vec<Entry> = Vec::with_capacity(list.len());
        for id in &ids {
            if let Some(e) = list.iter().find(|e| &e.id == id) {
                if !next.iter().any(|n| &n.id == id) {
                    next.push(e.clone());
                }
            }
        }
        if next.len() != list.len() {
            return Err("Список профилей изменился, открой настройки заново".into());
        }
        *list = next;
        save_registry(&app, &list)?;
    }
    profiles_changed(&app);
    Ok(())
}

#[tauri::command]
fn rename_profile(
    app: AppHandle,
    reg: State<'_, Registry>,
    id: String,
    name: String,
) -> Result<(), String> {
    {
        let mut list = reg.0.lock().map_err(|e| e.to_string())?;
        let name = clean_name(&name, &list, Some(&id))?;
        let e = list
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| format!("Нет профиля {id}"))?;
        e.name = name;
        save_registry(&app, &list)?;
    }
    profiles_changed(&app);
    Ok(())
}

/// Удаление: база и вложения не стираются, а уезжают в backups/deleted/<профиль>-<время>.
/// Окно перед этим закрывает базу, иначе движок держал бы её открытой
#[tauri::command]
fn delete_profile(
    app: AppHandle,
    reg: State<'_, Registry>,
    active: State<'_, ActiveProfile>,
    id: String,
) -> Result<(), String> {
    {
        let mut list = reg.0.lock().map_err(|e| e.to_string())?;
        let pos = list
            .iter()
            .position(|e| e.id == id)
            .ok_or_else(|| format!("Нет профиля {id}"))?;
        let name = list[pos].name.clone();
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let grave = data_dir(&app)?
            .join("backups")
            .join("deleted")
            .join(format!("{id}-{secs}"));
        std::fs::create_dir_all(&grave).map_err(|e| e.to_string())?;
        let _ = std::fs::write(grave.join("name.txt"), &name);
        let dir = data_dir(&app)?;
        for ext in ["", "-wal", "-shm"] {
            let src = dir.join(format!("{}{ext}", db_file(&id)));
            if src.exists() {
                std::fs::rename(&src, grave.join(format!("{}{ext}", db_file(&id))))
                    .map_err(|e| format!("Не удалось убрать базу: {e}"))?;
            }
        }
        // Вложения: у «test» это числовые папки прямо в attachments, у остальных своя подпапка
        let att = attachments_dir(&app)?;
        if id == "test" {
            if let Ok(rd) = std::fs::read_dir(&att) {
                for e in rd.flatten() {
                    let n = e.file_name().to_string_lossy().to_string();
                    if n.chars().all(|c| c.is_ascii_digit()) {
                        let to = grave.join("attachments");
                        let _ = std::fs::create_dir_all(&to);
                        let _ = std::fs::rename(e.path(), to.join(&n));
                    }
                }
            }
        } else {
            let src = att.join(files_sub(&id));
            if src.exists() {
                let _ = std::fs::rename(&src, grave.join("attachments"));
            }
        }
        let _ = std::fs::remove_file(backups_dir(&app, &id)?.join("version"));
        list.remove(pos);
        save_registry(&app, &list)?;
    }
    if let Ok(mut done) = BACKED_UP.lock() {
        done.retain(|d| d != &id);
    }
    if let Ok(mut a) = active.0.lock() {
        if *a == id {
            a.clear();
        }
    }
    profiles_changed(&app);
    Ok(())
}

/// Окно открывает базу профиля: сначала сюда, потом Database.load по возвращённому адресу.
/// Здесь же делается копия базы перед миграциями новой версии
#[tauri::command]
fn use_profile(
    app: AppHandle,
    active: State<'_, ActiveProfile>,
    id: String,
) -> Result<String, String> {
    let e = entry(&app, &id)?;
    {
        // Держим замок, пока копируем: второе окно подождёт и не откроет базу посреди копирования
        let mut done = BACKED_UP.lock().map_err(|e| e.to_string())?;
        if !done.contains(&e.id) {
            backup_before_migrations(&app, &e.id)?;
            done.push(e.id.clone());
        }
    }
    *active.0.lock().map_err(|e| e.to_string())? = e.id.clone();
    mark_tray_profile(&app, &e.id);
    Ok(db_url(&e.id))
}

/// Папка с копиями базы активного профиля в Finder. С deleted: папка с удалёнными профилями
#[tauri::command]
fn open_backups(
    app: AppHandle,
    active: State<'_, ActiveProfile>,
    deleted: Option<bool>,
) -> Result<(), String> {
    let dir = if deleted == Some(true) {
        data_dir(&app)?.join("backups").join("deleted")
    } else {
        let id = active.0.lock().map_err(|e| e.to_string())?.clone();
        if id.is_empty() {
            return Err("Профиль не выбран".into());
        }
        backups_dir(&app, &id)?
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Папка с копиями прикреплённых файлов: ~/Library/Application Support/com.igorchepenko.inbox/attachments,
/// у профилей кроме «Теста» своя подпапка внутри
fn attachments_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("attachments"))
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct StoredFile {
    name: String,
    path: String,
    size: u64,
}

/// Копирует файл в папку задачи. Если имя занято, добавляет номер: «отчёт 2.pdf»
#[tauri::command]
fn attach_file(
    app: AppHandle,
    active: State<'_, ActiveProfile>,
    task_id: i64,
    src: String,
) -> Result<StoredFile, String> {
    let sub = files_sub(&active.0.lock().map_err(|e| e.to_string())?);
    let src = PathBuf::from(src);
    let meta = std::fs::metadata(&src).map_err(|e| format!("Файл не найден: {e}"))?;
    if meta.is_dir() {
        return Err("Папку прикрепить нельзя, только файлы".into());
    }
    let name = src
        .file_name()
        .ok_or("У файла нет имени")?
        .to_string_lossy()
        .to_string();
    let dir = attachments_dir(&app)?.join(sub).join(task_id.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.clone());
    let ext = src
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut dest = dir.join(&name);
    let mut n = 2;
    while dest.exists() {
        dest = dir.join(format!("{stem} {n}{ext}"));
        n += 1;
    }
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(StoredFile {
        name: dest
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or(name),
        path: dest.to_string_lossy().to_string(),
        size: meta.len(),
    })
}

/// Путь лежит внутри папки вложений: удалять и открывать из интерфейса можно только свои копии
fn inside_attachments(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let root = attachments_dir(app)?;
    let p = Path::new(path);
    if p.starts_with(&root) && !path.contains("..") {
        Ok(p.to_path_buf())
    } else {
        Err("Файл вне папки вложений".into())
    }
}

#[tauri::command]
fn remove_attachment(app: AppHandle, path: String) -> Result<(), String> {
    let p = inside_attachments(&app, &path)?;
    let _ = std::fs::remove_file(&p);
    // Пустая папка задачи больше не нужна
    if let Some(dir) = p.parent() {
        let _ = std::fs::remove_dir(dir);
    }
    Ok(())
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let p = inside_attachments(&app, &path)?;
    app.opener()
        .open_path(p.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    let p = inside_attachments(&app, &path)?;
    app.opener()
        .reveal_item_in_dir(p)
        .map_err(|e| e.to_string())
}

/// Ссылки открываются в браузере по умолчанию. Только веб и почта, без file:// и прочего
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_lowercase();
    if !(lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:"))
    {
        return Err("Открываются только ссылки http, https и mailto".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct QuickStatus {
    registered: bool,
    error: Option<String>,
    /// Запущенные приложения, которые тоже могут слушать ⌥Space
    conflicts: Vec<String>,
}

fn alt_space_apps() -> Vec<String> {
    let Ok(out) = std::process::Command::new("/bin/ps")
        .args(["-axo", "comm="])
        .output()
    else {
        return vec![];
    };
    let list = String::from_utf8_lossy(&out.stdout);
    ALT_SPACE_APPS
        .iter()
        .filter(|(needle, _)| list.lines().any(|l| l.contains(needle)))
        .map(|(_, name)| name.to_string())
        .collect()
}

/// Состояние сочетания быстрого ввода для настроек и плашки об ошибке
#[tauri::command]
fn quick_shortcut_status(app: AppHandle, key: State<'_, QuickKey>) -> QuickStatus {
    let cur = key.0.lock().map(|k| *k).ok();
    let registered = cur.is_some_and(|k| app.global_shortcut().is_registered(k));
    let alt_space = cur == Some(Shortcut::new(Some(Modifiers::ALT), Code::Space));
    QuickStatus {
        registered,
        error: QUICK_ERROR.lock().ok().and_then(|e| e.clone()),
        conflicts: if alt_space { alt_space_apps() } else { vec![] },
    }
}

/// Включить или выключить проверку: следующее нажатие сочетания придёт событием quick-shortcut-hit
#[tauri::command]
fn test_quick_shortcut(on: bool) {
    TESTING_QUICK.store(on, Ordering::Relaxed);
}

/// Сменить сочетание быстрого ввода. accel в формате «Alt+Shift+KeyN», label для меню вида «⌥⇧N».
/// Если сочетание занято системой или другим приложением, оставляем прежнее и возвращаем ошибку
#[tauri::command]
fn set_quick_shortcut(
    app: AppHandle,
    key: State<'_, QuickKey>,
    tray: State<'_, TrayQuickItem>,
    accel: String,
    label: String,
) -> Result<(), String> {
    let next: Shortcut = accel
        .parse()
        .map_err(|e| format!("Не получилось разобрать сочетание: {e}"))?;
    let mut cur = key.0.lock().map_err(|e| e.to_string())?;
    let gs = app.global_shortcut();
    if *cur != next || !gs.is_registered(next) {
        let _ = gs.unregister(*cur);
        if let Err(e) = gs.register(next) {
            let _ = gs.register(*cur);
            return Err(format!(
                "Сочетание занято системой или другим приложением ({e})"
            ));
        }
        *cur = next;
    }
    if let Ok(mut e) = QUICK_ERROR.lock() {
        *e = None;
    }
    let _ = tray.0.set_text(format!("Записать задачу    {label}"));
    Ok(())
}

fn open_settings(app: &AppHandle) {
    show_main(app);
    let _ = app.emit_to("main", "open-settings", ());
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let quick_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    let autostart_args: Option<Vec<&'static str>> = None;

    // У каждого профиля своя база с теми же миграциями
    let sql = all_ids().fold(tauri_plugin_sql::Builder::default(), |b, id| {
        b.add_migrations(&db_url(id), migrations())
    });

    let app = tauri::Builder::default()
        .plugin(sql.build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            autostart_args,
        ))
        .plugin(
            // Зарегистрировано всегда одно сочетание, быстрого ввода, поэтому сверять, какое нажато, не нужно
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if TESTING_QUICK.swap(false, Ordering::Relaxed) {
                        let _ = app.emit_to("main", "quick-shortcut-hit", ());
                        return;
                    }
                    toggle_quick(app);
                })
                .build(),
        )
        .manage(QuickKey(Mutex::new(quick_shortcut)))
        .manage(ActiveProfile(Mutex::new(String::new())))
        .invoke_handler(tauri::generate_handler![
            hide_quick,
            quick_picking,
            set_quick_shortcut,
            quick_shortcut_status,
            test_quick_shortcut,
            attach_file,
            remove_attachment,
            open_path,
            reveal_path,
            open_url,
            use_profile,
            list_profiles,
            profile_url,
            create_profile,
            rename_profile,
            reorder_profiles,
            delete_profile,
            open_backups,
            notify::notify_status,
            notify::notify_send,
            notify::notify_plan
        ])
        // «Настройки…» ⌘, в меню приложения
        .on_menu_event(|app, event| {
            if event.id() == "settings" {
                open_settings(app);
            }
        })
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            if let Some(w) = app.get_webview_window("quick") {
                quick_panel::convert(&w);
            }

            // ⌥Space может не достаться: тогда работаем через иконку в строке меню, а главное окно
            // показывает плашку с причиной и кнопкой «Сменить сочетание»
            if let Err(e) = app.global_shortcut().register(quick_shortcut) {
                eprintln!("Не удалось занять ⌥Space: {e}");
                if let Ok(mut slot) = QUICK_ERROR.lock() {
                    *slot = Some(format!(
                        "macOS не дала занять ⌥Space ({e}). Так бывает на macOS 15.0 и 15.1, где запрещены сочетания только с ⌥, или если сочетание занято системой"
                    ));
                }
            }

            let quick_i = MenuItem::with_id(
                app,
                "quick",
                "Записать задачу    ⌥Space",
                true,
                None::<&str>,
            )?;
            let open_i = MenuItem::with_id(app, "open", "Открыть Inbox", true, None::<&str>)?;
            let settings_i =
                MenuItem::with_id(app, "tray-settings", "Настройки…", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_i =
                MenuItem::with_id(app, "quit", "Выйти из Inbox", true, Some("CmdOrCtrl+Q"))?;
            // Список профилей читаем здесь: до этого окна не открыты и команд не шлют
            app.manage(Registry(Mutex::new(load_registry(app.handle()))));
            // Пункты профилей и галочку расставляют rebuild_tray_profiles и use_profile
            let profile_sub = Submenu::with_items(app, "Профиль", true, &[])?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[&quick_i, &open_i, &settings_i, &sep2, &profile_sub, &sep, &quit_i],
            )?;
            app.manage(TrayQuickItem(quick_i.clone()));
            app.manage(TrayProfiles {
                sub: profile_sub.clone(),
                items: Mutex::new(Vec::new()),
            });
            rebuild_tray_profiles(app.handle())?;

            // Стандартное меню macOS (Правка с копированием и вставкой, Окно) плюс «Настройки…» после «О программе»
            #[cfg(target_os = "macos")]
            {
                let app_menu = Menu::default(app.handle())?;
                if let Some(MenuItemKind::Submenu(sub)) = app_menu.items()?.first() {
                    let prefs_i = MenuItem::with_id(
                        app,
                        "settings",
                        "Настройки…",
                        true,
                        Some("CmdOrCtrl+,"),
                    )?;
                    sub.insert(&PredefinedMenuItem::separator(app)?, 1)?;
                    sub.insert(&prefs_i, 2)?;
                }
                app.set_menu(app_menu)?;
            }

            TrayIconBuilder::with_id("tray")
                .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(true)
                .tooltip("Inbox")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quick" => toggle_quick(app),
                    "open" => show_main(app),
                    "tray-settings" => open_settings(app),
                    "quit" => app.exit(0),
                    id => {
                        if let Some(pid) = id.strip_prefix("profile:") {
                            // Меню само переключило галочку: вернём её к активному, пока окно не перезагрузилось
                            let cur = active_id(app);
                            mark_tray_profile(app, &cur);
                            if pid != cur {
                                // Переключает главное окно: запоминает выбор и перезагружает оба окна
                                show_main(app);
                                let _ = app.emit_to("main", "profile-pick", pid.to_string());
                            }
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_quick(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Закрытие главного окна прячет его: приложение живёт в строке меню и присылает напоминания
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            // Быстрый ввод прячется, как только фокус ушёл в другое приложение, и в следующий раз откроется чистым
            WindowEvent::Focused(false) if window.label() == "quick" && !QUICK_PICKING.load(Ordering::SeqCst) => {
                hide_quick(window.app_handle().clone());
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("не удалось запустить Inbox");

    app.run(|app, event| {
        // Клик по иконке в Dock возвращает спрятанное главное окно
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main(app);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
