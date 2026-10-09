use std::fs;
use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalRect, WebviewWindow, Wry};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::{StateFlags, WindowExt as _};

/// Downloaded skins beyond this total are deleted, oldest first.
const SKIN_CACHE_CAP_BYTES: u64 = 200 * 1024 * 1024;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch hands over and exits before anything else runs.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_player(app)
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        // Position only: main.ts sizes the window to Webamp. Restored in
        // setup rather than by the plugin, so it can be kept on screen.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION)
                .with_denylist(&["picker"])
                .skip_initial_state("main")
                .build(),
        )
        .setup(|app| {
            if let Some(main) = app.get_webview_window("main") {
                main.restore_state(StateFlags::POSITION)?;
                keep_on_screen(&main.as_ref().window())?;
            }
            build_tray(app.handle())?;
            // A dev build would otherwise replace itself with the release.
            if !cfg!(debug_assertions) {
                let app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Offline or no release yet: play on, try next launch.
                    if let Err(error) = update(app).await {
                        eprintln!("update check failed: {error}");
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cached_skins,
            read_skin,
            write_skin,
            set_tray_tooltip,
            set_hit_region
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                // Closing the player quits, even with the skin browser still open.
                tauri::WindowEvent::Destroyed => window.app_handle().exit(0),
                // main.ts sizes the window to Webamp's windows: keep the
                // grown window on screen too. A minimized one is off screen on purpose.
                tauri::WindowEvent::Resized(_) if !window.is_minimized().unwrap_or(true) => {
                    if let Err(error) = keep_on_screen(window) {
                        eprintln!("could not keep the player on screen: {error}");
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Installs a newer GitHub release, if there is one, and restarts into it.
/// On Windows the installer closes the app itself, so the stream drops for
/// the few seconds the install takes.
async fn update(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    if let Some(update) = app.updater()?.check().await? {
        update.download_and_install(|_, _| {}, || {}).await?;
        app.restart();
    }
    Ok(())
}

/// Brings the player back: a second launch, or a click on the tray icon.
fn show_player(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

/// The window-state plugin restores the saved position only when it is on a
/// monitor. Pull the rest of the window into that monitor's work area too,
/// so none of it ends up off screen or under the taskbar after a monitor is
/// unplugged or rearranged, or when the window grows.
fn keep_on_screen(window: &tauri::Window) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) else {
        return Ok(());
    };
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let fitted = fit_into(position, (size.width, size.height), monitor.work_area());
    if fitted != position {
        window.set_position(fitted)?;
    }
    Ok(())
}

/// The nearest position to `position` that puts a window of `size` inside
/// `area`; its top-left corner if the window is bigger than the area.
fn fit_into(
    position: PhysicalPosition<i32>,
    (width, height): (u32, u32),
    area: &PhysicalRect<i32, u32>,
) -> PhysicalPosition<i32> {
    let (left, top) = (area.position.x, area.position.y);
    let right = left + area.size.width as i32;
    let bottom = top + area.size.height as i32;
    PhysicalPosition::new(
        position.x.min(right - width as i32).max(left),
        position.y.min(bottom - height as i32).max(top),
    )
}

/// The tray icon and its menu. main.ts handles the player and skin entries.
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let menu = Menu::with_items(
        app,
        &[
            &item("play-pause", "Play / Pause")?,
            &item("nts1", "NTS 1")?,
            &item("nts2", "NTS 2")?,
            &PredefinedMenuItem::separator(app)?,
            &Submenu::with_items(
                app,
                "Skin",
                true,
                &[
                    &item("random-skin", "Random Skin")?,
                    &item("open-picker", "Skin Browser...")?,
                ],
            )?,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &item("quit", "Quit")?,
        ],
    )?;
    app.manage(autostart);
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Unofficial NTS Player")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_tray_menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_player(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn on_tray_menu(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    let result = match id {
        "quit" => {
            app.exit(0);
            Ok(())
        }
        "autostart" => toggle_autostart(app),
        // skins.ts listens for these two by name.
        "random-skin" | "open-picker" => app.emit_to("main", id, ()).map_err(|e| e.to_string()),
        _ => app.emit_to("main", "tray", id).map_err(|e| e.to_string()),
    };
    if let Err(error) = result {
        eprintln!("tray menu {id}: {error}");
    }
}

/// Flips the HKCU Run entry. Windows ticks the menu item on click; set it
/// back to what the registry holds, in case the write failed.
fn toggle_autostart(app: &AppHandle) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    let result = if autolaunch.is_enabled().map_err(|e| e.to_string())? {
        autolaunch.disable()
    } else {
        autolaunch.enable()
    };
    let enabled = autolaunch.is_enabled().map_err(|e| e.to_string())?;
    app.state::<CheckMenuItem<Wry>>()
        .set_checked(enabled)
        .map_err(|e| e.to_string())?;
    result.map_err(|e| e.to_string())
}

#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) -> Result<(), String> {
    let tray = app.tray_by_id("main").ok_or("no tray icon")?;
    tray.set_tooltip(Some(fit_tooltip(&text)))
        .map_err(|e| e.to_string())
}

/// Windows keeps 127 UTF-16 units of a tray tooltip, and tray-icon copies a
/// longer one without its terminator. Cut on a character boundary.
fn fit_tooltip(text: &str) -> String {
    let mut units = 0;
    text.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= 127
        })
        .collect()
}

/// Clicks on the window's transparent gaps go to whatever is behind it:
/// the window keeps only `rects` (left, top, right, bottom, in physical
/// pixels from its top-left corner), which main.ts sets to Webamp's windows
/// and menus.
#[tauri::command]
fn set_hit_region(window: WebviewWindow, rects: Vec<[i32; 4]>) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Graphics::Gdi::{
            CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_OR,
        };
        // An empty region would hide the whole window.
        if rects.is_empty() {
            return Ok(());
        }
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let region = CreateRectRgn(0, 0, 0, 0);
        for [left, top, right, bottom] in rects {
            let part = CreateRectRgn(left, top, right, bottom);
            CombineRgn(region, region, part, RGN_OR);
            DeleteObject(part);
        }
        // On success Windows owns the region; on failure it is still ours.
        if SetWindowRgn(hwnd.0, region, 1) == 0 {
            DeleteObject(region);
            return Err("SetWindowRgn failed".into());
        }
    }
    // ponytail: no click-through outside Windows yet; macOS is phase 2.
    #[cfg(not(windows))]
    let _ = (window, rects);
    Ok(())
}

/// `%LOCALAPPDATA%\com.datatuna.ntswinamp\skins` on Windows. Skins live only
/// here, never in the repo or the installer (AGENTS.md, Invariants).
fn skins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("skins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The md5 names the file, so it must be exactly that: no path tricks.
fn skin_path(dir: &Path, md5: &str) -> Result<PathBuf, String> {
    let valid = md5.len() == 32 && md5.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if !valid {
        return Err(format!("not an md5: {md5:?}"));
    }
    Ok(dir.join(format!("{md5}.wsz")))
}

/// The md5s of every skin in the cache.
#[tauri::command]
fn cached_skins(app: AppHandle) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(skins_dir(&app)?).map_err(|e| e.to_string())?;
    Ok(entries
        .filter_map(|entry| {
            let name = entry.ok()?.file_name().into_string().ok()?;
            Some(name.strip_suffix(".wsz")?.to_owned())
        })
        .collect())
}

#[tauri::command]
fn read_skin(app: AppHandle, md5: String) -> Result<Response, String> {
    let bytes = fs::read(skin_path(&skins_dir(&app)?, &md5)?).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// Body: the raw `.wsz` bytes. Header `md5`: the skin's Museum md5.
#[tauri::command]
fn write_skin(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let md5 = request
        .headers()
        .get("md5")
        .and_then(|value| value.to_str().ok())
        .ok_or("missing md5 header")?;
    let dir = skins_dir(&app)?;
    let path = skin_path(&dir, md5)?;
    // Write then rename, so a crash never leaves a truncated skin behind.
    let partial = path.with_extension("part");
    fs::write(&partial, bytes).map_err(|e| e.to_string())?;
    fs::rename(&partial, &path).map_err(|e| e.to_string())?;
    // The skin is saved either way; a failed prune only delays the cap.
    if let Err(error) = prune(&dir, SKIN_CACHE_CAP_BYTES, &path) {
        eprintln!("could not prune the skin cache: {error}");
    }
    Ok(())
}

/// Deletes the oldest `.wsz` files in `dir` until the rest fit in `cap`
/// bytes. Never deletes `keep`, the skin just written.
fn prune(dir: &Path, cap: u64, keep: &Path) -> std::io::Result<()> {
    let mut files = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_file() && entry.path().extension().is_some_and(|ext| ext == "wsz") {
            files.push((meta.modified()?, meta.len(), entry.path()));
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let mut total = 0;
    for (_, len, path) in files {
        total += len;
        if total > cap && path != keep {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    #[test]
    fn prune_deletes_oldest_past_the_cap_but_keeps_the_new_skin() {
        let dir = std::env::temp_dir().join(format!("nts-skin-prune-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let now = SystemTime::now();
        // a is newest, d oldest; each is 10 bytes.
        for (i, name) in ["a", "b", "c", "d"].iter().enumerate() {
            let path = dir.join(format!("{name}.wsz"));
            fs::write(&path, [0u8; 10]).unwrap();
            let file = fs::File::options().write(true).open(&path).unwrap();
            file.set_modified(now - Duration::from_secs(60 * i as u64))
                .unwrap();
        }
        fs::write(dir.join("notes.txt"), [0u8; 100]).unwrap();

        // Room for two; d is the skin just written, so it stays though oldest.
        prune(&dir, 20, &dir.join("d.wsz")).unwrap();

        let mut left: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        fs::remove_dir_all(&dir).unwrap();
        assert_eq!(left, ["a.wsz", "b.wsz", "d.wsz", "notes.txt"]);
    }

    #[test]
    fn fit_into_pulls_an_off_screen_window_onto_the_work_area() {
        let area = PhysicalRect {
            position: PhysicalPosition::new(0, 0),
            size: tauri::PhysicalSize::new(1920, 1040),
        };
        let fit = |x, y| fit_into(PhysicalPosition::new(x, y), (275, 348), &area);
        assert_eq!(fit(100, 100), PhysicalPosition::new(100, 100));
        assert_eq!(fit(-50, -200), PhysicalPosition::new(0, 0));
        // Only a corner was on screen: a monitor to the right was unplugged.
        assert_eq!(fit(1900, 900), PhysicalPosition::new(1645, 692));
    }

    #[test]
    fn fit_tooltip_keeps_127_utf16_units_on_a_char_boundary() {
        assert_eq!(fit_tooltip("NTS 1 - Show"), "NTS 1 - Show");
        assert_eq!(fit_tooltip(&"a".repeat(200)).len(), 127);
        // 63 two-unit emoji fill 126 units; a 64th would make 128.
        let emoji = "\u{1F4FB}".repeat(64);
        assert_eq!(fit_tooltip(&emoji).chars().count(), 63);
    }

    #[test]
    fn skin_path_rejects_anything_but_an_md5() {
        let dir = Path::new("skins");
        assert!(skin_path(dir, "c1dca330af717fc9895eefd0ff0204d9").is_ok());
        assert!(skin_path(dir, "../../../../windows/system32/x").is_err());
        assert!(skin_path(dir, "C1DCA330AF717FC9895EEFD0FF0204D9").is_err());
        assert!(skin_path(dir, "").is_err());
    }
}
