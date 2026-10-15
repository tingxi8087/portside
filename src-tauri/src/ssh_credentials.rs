use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, io::Write, path::{Path, PathBuf}, sync::{atomic::{AtomicU64, Ordering}, Mutex}};
use tauri::Manager;

type Result<T> = std::result::Result<T, String>;
const MAX_BYTES: usize = 8 * 1024 * 1024;
static LOCK: Mutex<()> = Mutex::new(());
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Credentials {
    pub password: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FileData {
    version: u8,
    credentials: HashMap<String, Credentials>,
}
impl Default for FileData {
    fn default() -> Self { Self { version: 1, credentials: HashMap::new() } }
}

pub fn path(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("ssh-credentials.json"))
}
fn load(path: &Path) -> Result<FileData> {
    let metadata = match fs::metadata(path) {
        Ok(value) => value,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(FileData::default()),
        Err(e) => return Err(format!("读取本地 SSH 凭据失败：{e}")),
    };
    if metadata.len() > MAX_BYTES as u64 { return Err("本地 SSH 凭据文件超过 8 MB".into()); }
    let bytes = fs::read(path).map_err(|e| format!("读取本地 SSH 凭据失败：{e}"))?;
    let value: FileData = serde_json::from_slice(&bytes).map_err(|_| "本地 SSH 凭据文件格式无效，未覆盖原文件".to_string())?;
    if value.version != 1 { return Err("不支持此版本的本地 SSH 凭据文件，未覆盖原文件".into()); }
    Ok(value)
}
fn store(path: &Path, value: &FileData) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES { return Err("本地 SSH 凭据超过 8 MB，未覆盖原文件".into()); }
    let parent = path.parent().ok_or("无效的凭据目录")?;
    fs::create_dir_all(parent).map_err(|e| format!("创建凭据目录失败：{e}"))?;
    let temporary = parent.join(format!(".ssh-credentials-{}-{}.tmp", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
    let mut created = false;
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        created = true;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if created && result.is_err() { let _ = fs::remove_file(&temporary); }
    result.map_err(|e| format!("保存本地 SSH 凭据失败：{e}"))
}
pub fn read_at(path: &Path, id: &str) -> Result<Credentials> {
    let _guard = LOCK.lock().map_err(|_| "凭据文件锁错误")?;
    Ok(load(path)?.credentials.remove(id).unwrap_or_default())
}
pub fn save_at(path: &Path, id: String, value: Credentials) -> Result<()> {
    if id.is_empty() { return Err("连接 ID 不能为空".into()); }
    let _guard = LOCK.lock().map_err(|_| "凭据文件锁错误")?;
    let mut data = load(path)?;
    data.credentials.insert(id, value);
    store(path, &data)
}
pub fn delete_at(path: &Path, id: &str) -> Result<()> {
    let _guard = LOCK.lock().map_err(|_| "凭据文件锁错误")?;
    let mut data = load(path)?;
    if data.credentials.remove(id).is_none() { return Ok(()); }
    store(path, &data)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("portside-local-credentials-{}-{}", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed))))
        }
        fn path(&self) -> PathBuf { self.0.join("ssh-credentials.json") }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn password(value: &str) -> Credentials { Credentials { password: Some(value.into()), passphrase: None } }

    #[test]
    fn roundtrip_update_and_delete_preserve_other_servers() {
        let fixture = Fixture::new(); let path = fixture.path();
        assert!(read_at(&path, "a").unwrap().password.is_none());
        save_at(&path, "a".into(), password("first")).unwrap();
        save_at(&path, "../../server".into(), Credentials { password: None, passphrase: Some("中文口令'\n".into()) }).unwrap();
        save_at(&path, "a".into(), password("updated")).unwrap();
        assert_eq!(read_at(&path, "a").unwrap().password.as_deref(), Some("updated"));
        assert_eq!(read_at(&path, "../../server").unwrap().passphrase.as_deref(), Some("中文口令'\n"));
        assert!(fs::read_to_string(&path).unwrap().contains("updated")); // Deliberately plaintext, per the user's choice.
        delete_at(&path, "a").unwrap(); delete_at(&path, "missing").unwrap();
        assert!(read_at(&path, "a").unwrap().password.is_none());
        assert!(read_at(&path, "../../server").unwrap().passphrase.is_some());
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }
    #[test]
    fn malformed_or_unknown_version_is_never_overwritten() {
        let fixture = Fixture::new(); fs::create_dir_all(&fixture.0).unwrap(); let path = fixture.path();
        for invalid in ["broken", r#"{"version":2,"credentials":{}}"#, r#"{"version":1,"credentials":{"a":{"password":42}}}"#] {
            fs::write(&path, invalid).unwrap();
            assert!(read_at(&path, "a").is_err());
            assert!(save_at(&path, "a".into(), password("new")).is_err());
            assert!(delete_at(&path, "a").is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), invalid);
        }
    }
    #[test]
    fn oversized_write_preserves_previous_file() {
        let fixture = Fixture::new(); let path = fixture.path();
        save_at(&path, "a".into(), password("original")).unwrap(); let original = fs::read(&path).unwrap();
        assert!(save_at(&path, "a".into(), password(&"x".repeat(MAX_BYTES))).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
    }
    #[test]
    fn concurrent_updates_do_not_lose_other_entries() {
        let fixture = Fixture::new(); let path = fixture.path();
        let threads: Vec<_> = (0..12).map(|i| { let path = path.clone(); std::thread::spawn(move || save_at(&path, i.to_string(), password("fixture")).unwrap()) }).collect();
        for thread in threads { thread.join().unwrap(); }
        for i in 0..12 { assert!(read_at(&path, &i.to_string()).unwrap().password.is_some()); }
    }
    #[test]
    fn deleting_missing_entry_does_not_create_a_file() {
        let fixture = Fixture::new(); delete_at(&fixture.path(), "missing").unwrap();
        assert!(!fixture.path().exists());
    }
    #[test]
    #[cfg(unix)]
    fn saved_and_replaced_files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new(); let path = fixture.path();
        save_at(&path, "a".into(), password("fixture")).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        save_at(&path, "a".into(), password("replacement")).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
}
