mod config;
mod desktop;
mod system;
mod terminal;
mod ssh;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(config::ConfigLock::default())
        .manage(system::SystemMonitor::default())
        .manage(terminal::TerminalManager::default())
        .invoke_handler(tauri::generate_handler![config::config_read, config::config_write, desktop::clipboard_read, desktop::clipboard_write, desktop::pick_directory, system::system_snapshot, system::terminate_process, terminal::terminal_start, terminal::terminal_write, terminal::terminal_resize, terminal::terminal_ack, terminal::terminal_close,
            ssh::ssh_host_info,ssh::ssh_trust_host,ssh::ssh_save_credentials,ssh::ssh_delete_credentials,ssh::ssh_has_credentials,ssh::ssh_connect,ssh::ssh_disconnect,
            ssh::ssh_terminal_open,ssh::ssh_terminal_write,ssh::ssh_terminal_ack,ssh::ssh_terminal_resize,ssh::ssh_terminal_close,
            ssh::ssh_list,ssh::ssh_file_action,ssh::ssh_transfer_cancel,ssh::ssh_pick_upload,ssh::ssh_pick_download,ssh::ssh_transfer])
        .build(tauri::generate_context!())
        .expect("error while building Portside")
        .run(|app,event| { if let tauri::RunEvent::Exit = event {
            use tauri::Manager;
            app.state::<terminal::TerminalManager>().close_all();
            ssh::close_all();
        }});
}
