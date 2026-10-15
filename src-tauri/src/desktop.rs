#[tauri::command]
pub fn clipboard_write(text:String)->Result<(),String>{arboard::Clipboard::new().map_err(|e|e.to_string())?.set_text(text).map_err(|e|e.to_string())}
#[tauri::command]
pub fn clipboard_read()->Result<String,String>{arboard::Clipboard::new().map_err(|e|e.to_string())?.get_text().map_err(|e|e.to_string())}
#[tauri::command]
pub async fn pick_directory()->Result<Option<String>,String>{let folder=rfd::AsyncFileDialog::new().set_title("选择工作目录").pick_folder().await;Ok(folder.map(|file|file.path().to_string_lossy().into_owned()))}
