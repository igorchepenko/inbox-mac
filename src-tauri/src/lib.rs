use tauri::{
    image::Image,
    menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent, Wry,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_sql::{Migration, MigrationKind};

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

const DB_URL: &str = "sqlite:inbox.db";

/// Было ли главное окно активно, когда открыли быстрый ввод. Если нет, после ввода
/// возвращаем фокус в приложение, из которого нажали ⌥Space.
static MAIN_WAS_FOCUSED: AtomicBool = AtomicBool::new(false);

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
            version: 7,
            description: "kanban stage: started_at",
            sql: include_str!("../migrations/007_task_started.sql"),
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
    let _ = w.center();
    let _ = w.show();
    let _ = w.set_focus();
    // Окно сбрасывает поля и ставит курсор в название
    let _ = app.emit_to("quick", "quick-open", ());
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

/// Папка с копиями прикреплённых файлов: ~/Library/Application Support/com.igorchepenko.inbox/attachments
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
fn attach_file(app: AppHandle, task_id: i64, src: String) -> Result<StoredFile, String> {
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
    let dir = attachments_dir(&app)?.join(task_id.to_string());
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
            return Err(format!("Сочетание занято системой или другим приложением ({e})"));
        }
        *cur = next;
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

    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
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
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick(app);
                    }
                })
                .build(),
        )
        .manage(QuickKey(Mutex::new(quick_shortcut)))
        .invoke_handler(tauri::generate_handler![
            hide_quick,
            set_quick_shortcut,
            attach_file,
            remove_attachment,
            open_path,
            reveal_path,
            open_url
        ])
        // «Настройки…» ⌘, в меню приложения
        .on_menu_event(|app, event| {
            if event.id() == "settings" {
                open_settings(app);
            }
        })
        .setup(move |app| {
            // ⌥Space может быть занят другим приложением: тогда работаем без него, через иконку в строке меню
            if let Err(e) = app.global_shortcut().register(quick_shortcut) {
                eprintln!("Не удалось занять ⌥Space: {e}");
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
            let menu = Menu::with_items(app, &[&quick_i, &open_i, &settings_i, &sep, &quit_i])?;
            app.manage(TrayQuickItem(quick_i.clone()));

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
                    _ => {}
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
