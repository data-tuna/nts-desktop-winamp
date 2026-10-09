use std::fs;
use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

/// Downloaded skins beyond this total are deleted, oldest first.
const SKIN_CACHE_CAP_BYTES: u64 = 200 * 1024 * 1024;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
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
            write_skin
        ])
        // Closing the player quits, even with the skin browser still open.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
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
    fn skin_path_rejects_anything_but_an_md5() {
        let dir = Path::new("skins");
        assert!(skin_path(dir, "c1dca330af717fc9895eefd0ff0204d9").is_ok());
        assert!(skin_path(dir, "../../../../windows/system32/x").is_err());
        assert!(skin_path(dir, "C1DCA330AF717FC9895EEFD0FF0204D9").is_err());
        assert!(skin_path(dir, "").is_err());
    }
}
