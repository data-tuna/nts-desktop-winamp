fn main() {
    // Listing the app's commands makes each one need a permission, so only
    // the main window (capabilities/default.json) can touch the skin cache.
    const COMMANDS: &[&str] = &[
        "cached_skins",
        "read_skin",
        "write_skin",
        "set_tray_tooltip",
        "set_hit_region",
        "keep_on_screen",
    ];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
