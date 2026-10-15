#[tauri::command]
pub fn clipboard_write(text:String)->Result<(),String>{arboard::Clipboard::new().map_err(|e|e.to_string())?.set_text(text).map_err(|e|e.to_string())}
#[tauri::command]
pub fn clipboard_read()->Result<String,String>{arboard::Clipboard::new().map_err(|e|e.to_string())?.get_text().map_err(|e|e.to_string())}
#[tauri::command]
pub async fn pick_directory()->Result<Option<String>,String>{let folder=rfd::AsyncFileDialog::new().set_title("选择工作目录").pick_folder().await;Ok(folder.map(|file|file.path().to_string_lossy().into_owned()))}

#[derive(serde::Serialize)]
pub struct ShortcutImportFile { name: String, content: String }

#[tauri::command]
pub async fn shortcut_import_file() -> Result<Option<ShortcutImportFile>, String> {
    let Some(file) = rfd::AsyncFileDialog::new().set_title("导入快捷指令").add_filter("快捷指令 JSON", &["json"]).pick_file().await else { return Ok(None) };
    let name = file.file_name();
    let path = file.path().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(4 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.len() > 4 * 1024 * 1024 { return Err("文件不能超过 4 MB".into()) }
        let content = String::from_utf8(bytes).map_err(|_| "文件必须使用 UTF-8 编码".to_string())?;
        Ok(Some(ShortcutImportFile {name, content}))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn shortcut_export_file(content: String) -> Result<bool, String> {
    if content.len() > 4 * 1024 * 1024 { return Err("导出文件不能超过 4 MB，请分批导出".into()) }
    let Some(file) = rfd::AsyncFileDialog::new().set_title("导出快捷指令").add_filter("快捷指令 JSON", &["json"]).set_file_name("Portside-快捷指令.json").save_file().await else { return Ok(false) };
    let path = file.path().to_owned();
    tauri::async_runtime::spawn_blocking(move || std::fs::write(path, content).map(|_| true).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}
