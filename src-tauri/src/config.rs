use std::{fs, path::PathBuf, sync::Mutex};
use tauri::Manager;
use serde_json::Value;

#[derive(Default)]
pub struct ConfigLock(Mutex<()>);
fn path(app:&tauri::AppHandle)->Result<PathBuf,String>{
    Ok(app.path().app_config_dir().map_err(|e|e.to_string())?.join("workspace.json"))
}
fn validate(value:&Value)->Result<(),String>{
    let state=value.get("state").and_then(Value::as_object).ok_or("配置格式无效")?;
    for key in state.keys(){if !["shortcuts","shortcutTags","servers","settings"].contains(&key.as_str()){return Err("配置含不支持的字段".into())}}
    if let Some(servers)=state.get("servers").and_then(Value::as_array){
        for server in servers{
            let server=server.as_object().ok_or("连接格式无效")?;
            for key in server.keys(){if !["id","name","host","user","port","auth","group","privateKeyPath"].contains(&key.as_str()){return Err(format!("连接中禁止保存字段：{key}"))}}
        }
    }
    Ok(())
}
#[tauri::command]
pub fn config_read(app:tauri::AppHandle,lock:tauri::State<ConfigLock>)->Result<Option<String>,String>{
    let _guard=lock.0.lock().map_err(|_|"配置锁错误")?;
    let file=path(&app)?;
    match fs::read_to_string(file){Ok(value)=>{validate(&serde_json::from_str::<Value>(&value).map_err(|e|format!("配置读取失败：{e}"))?)?;Ok(Some(value))},Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(None),Err(e)=>Err(format!("配置读取失败：{e}"))}
}
fn save(path:PathBuf,value:&str)->Result<(),String>{
    if value.len()>8*1024*1024{return Err("配置超过 8 MB，请使用较小的背景图片".into())}
    validate(&serde_json::from_str::<Value>(value).map_err(|e|e.to_string())?)?;
    let parent=path.parent().ok_or("无效配置目录")?;
    fs::create_dir_all(parent).map_err(|e|e.to_string())?;
    let temporary=path.with_extension("json.tmp");
    use std::io::Write;
    let mut options=fs::OpenOptions::new();options.write(true).create(true).truncate(true);
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
    let mut file=options.open(&temporary).map_err(|e|e.to_string())?;
    file.write_all(value.as_bytes()).map_err(|e|e.to_string())?;
    file.sync_all().map_err(|e|e.to_string())?;
    fs::rename(&temporary,path).map_err(|e|e.to_string())
}
#[tauri::command]
pub fn config_write(app:tauri::AppHandle,lock:tauri::State<ConfigLock>,value:String)->Result<(),String>{
    let _guard=lock.0.lock().map_err(|_|"配置锁错误")?;
    save(path(&app)?,&value)
}
#[cfg(test)] mod tests{
    use super::*;
    #[test]fn rejects_secrets(){assert!(validate(&serde_json::json!({"state":{"servers":[{"id":"a","password":"secret"}]}})).is_err())}
    #[test]fn atomic_roundtrip(){let dir=std::env::temp_dir().join(format!("portside-config-test-{}",std::process::id()));let path=dir.join("workspace.json");let content=r#"{"state":{"servers":[],"shortcuts":[],"settings":{}}}"#;save(path.clone(),content).unwrap();assert_eq!(fs::read_to_string(&path).unwrap(),content);assert!(!path.with_extension("json.tmp").exists());fs::remove_dir_all(dir).unwrap();}
}
