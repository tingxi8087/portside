mod config;
mod desktop;
mod system;
mod terminal;
mod ssh;
mod ssh_credentials;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(config::ConfigLock::default())
        .manage(system::SystemMonitor::default())
        .manage(terminal::TerminalManager::default())
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Closing the window behaves like Cmd+H. Only an explicit
                    // application quit should end the live terminal sessions.
                    api.prevent_close();
                    if let Err(error) = window.app_handle().hide() {
                        eprintln!("Could not hide Portside: {error}");
                        let _ = window.hide();
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![config::config_read, config::config_write, desktop::clipboard_read, desktop::clipboard_write, desktop::pick_directory, desktop::shortcut_import_file, desktop::shortcut_export_file, system::system_snapshot, system::terminate_process, terminal::terminal_start, terminal::terminal_write, terminal::terminal_resize, terminal::terminal_ack, terminal::terminal_close, terminal::terminal_has_tasks,
            ssh::ssh_host_info,ssh::ssh_trust_host,ssh::ssh_save_credentials,ssh::ssh_delete_credentials,ssh::ssh_has_credentials,ssh::ssh_connect,ssh::ssh_disconnect,
            ssh::ssh_terminal_open,ssh::ssh_terminal_write,ssh::ssh_terminal_ack,ssh::ssh_terminal_resize,ssh::ssh_terminal_close,
            ssh::text::ssh_text_read,ssh::text::ssh_text_save,ssh::ssh_list,ssh::ssh_file_action,ssh::ssh_transfer_cancel,ssh::ssh_pick_upload,ssh::ssh_pick_download,ssh::ssh_transfer])
        .build(tauri::generate_context!())
        .expect("error while building Portside")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                let _ = app.show();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            tauri::RunEvent::Exit => {
                app.state::<terminal::TerminalManager>().close_all();
                ssh::close_all();
            }
            _ => {}
        });
}
