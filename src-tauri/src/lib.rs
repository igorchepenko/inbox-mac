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

/// Профиль: своя база, свои вложения, свои настройки. У «Теста» база и папки прежние,
/// поэтому всё, что было до профилей, осталось в нём без переноса
struct ProfileDef {
    id: &'static str,
    name: &'static str,
    /// Файл базы в ~/Library/Application Support/com.igorchepenko.inbox
    file: &'static str,
    /// Папка вложений внутри attachments: у «Теста» пустая, файлы лежат как раньше
    files: &'static str,
}

const PROFILES: &[ProfileDef] = &[
    ProfileDef {
        id: "test",
        name: "Тест",
        file: "inbox.db",
        files: "",
    },
    ProfileDef {
        id: "igor",
        name: "Игорь",
        file: "inbox-igor.db",
        files: "igor",
    },
];

/// Сколько копий базы хранить на профиль: старые удаляются
const KEEP_BACKUPS: usize = 10;

fn profile(id: &str) -> Result<&'static ProfileDef, String> {
    PROFILES
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Нет профиля {id}"))
}

fn db_url(p: &ProfileDef) -> String {
    format!("sqlite:{}", p.file)
}

/// Активный профиль. Выбор хранит интерфейс (localStorage) и сообщает сюда при каждой загрузке окна
struct ActiveProfile(Mutex<&'static ProfileDef>);

/// Профили, у которых в этом запуске уже проверили копию базы
static BACKED_UP: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());

/// Пункты профилей в меню строки меню: галочка у активного
struct TrayProfiles(Vec<(&'static str, CheckMenuItem<Wry>)>);

/// Было ли главное окно активно, когда открыли быстрый ввод. Если нет, после ввода
/// возвращаем фокус в приложение, из которого нажали ⌥Space.
static MAIN_WAS_FOCUSED: AtomicBool = AtomicBool::new(false);

/// Ошибка, с которой не удалось занять сочетание быстрого ввода. Главное окно показывает её плашкой
static QUICK_ERROR: Mutex<Option<String>> = Mutex::new(None);

/// Идёт проверка сочетания в настройках: нажатие не открывает карточку, а сообщает главному окну, что дошло
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
    ]
}

/// Окно быстрого ввода: показать поверх всех приложений или спрятать, если уже открыто.
fn toggle_quick(app: &AppHandle) {
    let Some(w) = app.get_webview_window("quick") else {
        return;
    };
    if w.is_visible().unwrap_or(false) {
        hide_quick(app.clone());
        return;
    }
    let main_focused = app
        .get_webview_window("main")
        .and_then(|m| m.is_focused().ok())
        .unwrap_or(false);
    MAIN_WAS_FOCUSED.store(main_focused, Ordering::Relaxed);
    place_quick(&w);
    let _ = w.show();
    let _ = w.set_focus();
    // Окно сбрасывает поля и ставит курсор в название
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
    // Вокруг карточки в окне 10 px отступа (.quick-root), их вычитаем, чтобы сама карточка встала на 5%
    let pad = (10.0 * m.scale_factor()) as i32;
    let y = area.position.y + area.size.height as i32 / 20 - pad;
    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
}

/// Спрятать быстрый ввод после сохранения или Esc
#[tauri::command]
fn hide_quick(app: AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        let _ = w.hide();
    }
    // Как у Spotlight: macOS вернёт фокус туда, где ты был, и главное окно не выскочит поверх
    #[cfg(target_os = "macos")]
    if !MAIN_WAS_FOCUSED.load(Ordering::Relaxed) {
        let _ = app.hide();
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // Туда же tauri-plugin-sql кладёт базы: ~/Library/Application Support/com.igorchepenko.inbox
    app.path().app_config_dir().map_err(|e| e.to_string())
}

fn backups_dir(app: &AppHandle, p: &ProfileDef) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("backups").join(p.id))
}

/// Копия базы перед миграциями. Миграции приходят только с новой сборкой, поэтому копию делаем
/// при первом открытии базы в каждой новой версии приложения, до того как плагин её тронет.
/// Не получилось скопировать: базу не открываем, лучше ошибка на экране, чем миграция без копии
fn backup_before_migrations(app: &AppHandle, p: &ProfileDef) -> Result<(), String> {
    let db = data_dir(app)?.join(p.file);
    let dir = backups_dir(app, p)?;
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
    if let Some(items) = app.try_state::<TrayProfiles>() {
        for (pid, item) in &items.0 {
            let _ = item.set_checked(*pid == id);
        }
    }
    if let (Some(tray), Ok(p)) = (app.tray_by_id("tray"), profile(id)) {
        let _ = tray.set_tooltip(Some(format!("Inbox · {}", p.name)));
    }
}

/// Окно открывает базу профиля: сначала сюда, потом Database.load по возвращённому адресу.
/// Здесь же делается копия базы перед миграциями новой версии
#[tauri::command]
fn use_profile(
    app: AppHandle,
    active: State<'_, ActiveProfile>,
    id: String,
) -> Result<String, String> {
    let p = profile(&id)?;
    {
        // Держим замок, пока копируем: второе окно подождёт и не откроет базу посреди копирования
        let mut done = BACKED_UP.lock().map_err(|e| e.to_string())?;
        if !done.contains(&p.id) {
            backup_before_migrations(&app, p)?;
            done.push(p.id);
        }
    }
    *active.0.lock().map_err(|e| e.to_string())? = p;
    mark_tray_profile(&app, p.id);
    Ok(db_url(p))
}

/// Папка с копиями базы активного профиля в Finder
#[tauri::command]
fn open_backups(app: AppHandle, active: State<'_, ActiveProfile>) -> Result<(), String> {
    let p = *active.0.lock().map_err(|e| e.to_string())?;
    let dir = backups_dir(&app, p)?;
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
    let sub = active.0.lock().map_err(|e| e.to_string())?.files;
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
    let sql = PROFILES
        .iter()
        .fold(tauri_plugin_sql::Builder::default(), |b, p| {
            b.add_migrations(&db_url(p), migrations())
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
        .manage(ActiveProfile(Mutex::new(&PROFILES[0])))
        .invoke_handler(tauri::generate_handler![
            hide_quick,
            set_quick_shortcut,
            quick_shortcut_status,
            test_quick_shortcut,
            attach_file,
            remove_attachment,
            open_path,
            reveal_path,
            open_url,
            use_profile,
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
            // Профиль: галочку ставит use_profile, когда окно открыло базу
            let mut profile_items = Vec::new();
            for p in PROFILES {
                let item = CheckMenuItem::with_id(
                    app,
                    format!("profile:{}", p.id),
                    p.name,
                    true,
                    false,
                    None::<&str>,
                )?;
                profile_items.push((p.id, item));
            }
            let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
                profile_items.iter().map(|(_, i)| i as &dyn tauri::menu::IsMenuItem<Wry>).collect();
            let profile_sub = Submenu::with_items(app, "Профиль", true, &refs)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[&quick_i, &open_i, &settings_i, &sep2, &profile_sub, &sep, &quit_i],
            )?;
            app.manage(TrayQuickItem(quick_i.clone()));
            app.manage(TrayProfiles(profile_items));

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
                            let cur = app.state::<ActiveProfile>().0.lock().map(|p| p.id).unwrap_or("test");
                            mark_tray_profile(app, cur);
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
            // Быстрый ввод прячется, как только фокус ушёл в другое приложение
            WindowEvent::Focused(false) if window.label() == "quick" => {
                let _ = window.hide();
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
