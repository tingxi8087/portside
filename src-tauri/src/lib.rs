#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // UI prototype: no process, shell or SSH commands are registered.
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Portside");
}
