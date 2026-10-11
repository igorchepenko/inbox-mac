//! Уведомления через UNUserNotificationCenter (современный центр уведомлений macOS).
//!
//! Раньше уведомления шли через плагин Tauri, а он пользуется устаревшим NSUserNotificationCenter:
//! пока Inbox на переднем плане, macOS такие баннеры молча глотает, а ошибки плагин не возвращает.
//! Здесь баннер показывается и поверх активного Inbox, разрешение спрашивается явно, а напоминания
//! заранее ставятся в расписание самой macOS: они приходят вовремя, даже если окно Inbox спрятано
//! и его JavaScript спит.
//!
//! UNUserNotificationCenter работает только в подписанном .app, поэтому сборка подписывается
//! ad-hoc (bundle.macOS.signingIdentity = "-" в tauri.conf.json).

use serde::Deserialize;

/// Напоминание, которое надо поставить в расписание macOS
#[derive(Deserialize)]
pub struct Planned {
    /// Постоянный id: тот же id заменяет запланированное раньше
    key: String,
    title: String,
    body: String,
    /// Через сколько секунд показать
    delay: f64,
}

/// Все наши запланированные уведомления начинаются с этого id, чужие не трогаем
const PREFIX: &str = "inbox:";

#[cfg(target_os = "macos")]
mod imp {
    use super::{Planned, PREFIX};
    use mac_usernotifications::{
        block_on, blocking, cancel_pending, get_notification_settings,
        get_pending_notification_ids, AuthorizationStatus, Notification,
    };
    use std::time::Duration;

    fn with_sound(n: Notification, sound: Option<String>) -> Notification {
        match sound {
            Some(s) if !s.is_empty() => n.sound(s),
            _ => n,
        }
    }

    pub fn status(ask: bool) -> Result<String, String> {
        let st = block_on(get_notification_settings()).map_err(|e| e.to_string())?;
        let st = if ask && st.authorization_status == AuthorizationStatus::NotDetermined {
            blocking::request_auth().map_err(|e| e.to_string())?;
            block_on(get_notification_settings()).map_err(|e| e.to_string())?
        } else {
            st
        };
        Ok(match st.authorization_status {
            AuthorizationStatus::Authorized | AuthorizationStatus::Provisional | AuthorizationStatus::Ephemeral => "granted",
            AuthorizationStatus::Denied => "denied",
            _ => "unknown",
        }
        .into())
    }

    pub fn send(title: String, body: String, sound: Option<String>) -> Result<(), String> {
        let n = with_sound(Notification::new().title(title).message(body), sound);
        blocking::send(n).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn plan(items: Vec<Planned>, sound: Option<String>) -> Result<(), String> {
        // Снять всё, что ставили раньше, и поставить заново: так удалённые и перенесённые задачи не напомнят по-старому
        for id in block_on(get_pending_notification_ids()) {
            if id.starts_with(PREFIX) {
                block_on(cancel_pending(&id));
            }
        }
        for it in items {
            let n = Notification::new()
                .id(&format!("{PREFIX}{}", it.key))
                .title(it.title)
                .message(it.body)
                .schedule_in(Duration::from_secs_f64(it.delay.max(1.0)));
            blocking::send(with_sound(n, sound.clone())).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::Planned;

    pub fn status(_ask: bool) -> Result<String, String> {
        Ok("unsupported".into())
    }
    pub fn send(_title: String, _body: String, _sound: Option<String>) -> Result<(), String> {
        Err("Уведомления работают только на macOS".into())
    }
    pub fn plan(_items: Vec<Planned>, _sound: Option<String>) -> Result<(), String> {
        Ok(())
    }
}

// Вызовы ждут ответа macOS, поэтому идут в отдельном потоке, а не в главном

async fn off_main<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Разрешение на уведомления: granted, denied или unknown. ask = true спрашивает, если ещё не спрашивали
#[tauri::command]
pub async fn notify_status(ask: bool) -> Result<String, String> {
    off_main(move || imp::status(ask)).await
}

/// Показать уведомление сейчас
#[tauri::command]
pub async fn notify_send(title: String, body: String, sound: Option<String>) -> Result<(), String> {
    off_main(move || imp::send(title, body, sound)).await
}

/// Заменить расписание напоминаний целиком
#[tauri::command]
pub async fn notify_plan(items: Vec<Planned>, sound: Option<String>) -> Result<(), String> {
    off_main(move || imp::plan(items, sound)).await
}
