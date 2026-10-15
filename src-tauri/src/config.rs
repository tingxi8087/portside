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
    for key in ["shortcuts","shortcutTags","servers"] {if let Some(items)=state.get(key){if !items.is_array(){return Err(format!("{key} 必须为列表"))}}}
    if let Some(items)=state.get("shortcutTags").and_then(Value::as_array){if items.iter().any(|v|!v.is_string()){return Err("标签必须是文本".into())}}
    if let Some(items)=state.get("shortcuts").and_then(Value::as_array){for item in items{
        let item=item.as_object().ok_or("指令格式无效")?;
        for key in ["id","name","directory","command"] {if !item.get(key).map(Value::is_string).unwrap_or(false){return Err(format!("指令 {key} 必须是文本"))}}
        if let Some(tag)=item.get("tag"){if !tag.is_null()&&!tag.is_string(){return Err("标签格式无效".into())}}
        if let Some(tags)=item.get("tags"){if !tags.as_array().map(|v|v.iter().all(Value::is_string)).unwrap_or(false){return Err("旧标签格式无效".into())}}
    }}
    if let Some(items)=state.get("servers").and_then(Value::as_array){for item in items{
        for key in ["id","name","host","user","auth"]{if !item.get(key).map(Value::is_string).unwrap_or(false){return Err(format!("连接 {key} 必须是文本"))}}
        let port=item.get("port").and_then(Value::as_u64).ok_or("端口格式无效")?;if port==0||port>65535{return Err("端口超出范围".into())}
        if !["key","password","agent"].contains(&item["auth"].as_str().unwrap()){return Err("认证方式无效".into())}
        for key in ["group","privateKeyPath"]{if let Some(v)=item.get(key){if !v.is_null()&&!v.is_string(){return Err(format!("连接 {key} 格式无效"))}}}
    }}
    if let Some(settings)=state.get("settings"){
        let settings=settings.as_object().ok_or("外观配置格式无效")?;
        for key in ["theme","background","terminalTheme"]{if let Some(v)=settings.get(key){if !v.is_string(){return Err(format!("外观 {key} 必须是文本"))}}}
        for key in ["opacity","blur"]{if let Some(v)=settings.get(key){if !v.as_f64().map(|n|n.is_finite()&&(0.0..=100.0).contains(&n)).unwrap_or(false){return Err(format!("外观 {key} 超出范围"))}}}
        if let Some(v)=settings.get("extraColumns"){if !v.is_boolean(){return Err("列显示配置无效".into())}}
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
    #[test]fn rejects_malformed_shapes(){for value in [serde_json::json!({"state":{"shortcuts":{}}}),serde_json::json!({"state":{"shortcutTags":[42]}}),serde_json::json!({"state":{"settings":{"background":42}}})]{assert!(validate(&value).is_err())}}
    #[test]fn rejects_secrets(){assert!(validate(&serde_json::json!({"state":{"servers":[{"id":"a","password":"secret"}]}})).is_err())}
    #[test]fn atomic_roundtrip(){let dir=std::env::temp_dir().join(format!("portside-config-test-{}",std::process::id()));let path=dir.join("workspace.json");let content=r#"{"state":{"servers":[],"shortcuts":[],"settings":{}}}"#;save(path.clone(),content).unwrap();assert_eq!(fs::read_to_string(&path).unwrap(),content);assert!(!path.with_extension("json.tmp").exists());fs::remove_dir_all(dir).unwrap();}
}
