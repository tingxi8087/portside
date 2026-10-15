//! SSH is deliberately separate from local shells. Host keys are verified before authentication.
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ssh2::Session;
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{ipc::Channel, Manager};

type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub host: String,
    pub user: String,
    pub port: u16,
    pub auth: String,
    pub private_key_path: Option<String>,
}
pub use crate::ssh_credentials::Credentials;
#[derive(Clone)]
struct Connection {
    session: Session,
    target: Target,
    credentials: Credentials,
}
#[derive(Default)]
pub struct SshState {
    connections: Mutex<HashMap<String, Connection>>,
    terminals: Mutex<HashMap<String, Arc<TerminalControl>>>,
    transfers: Mutex<HashMap<String, Arc<AtomicBool>>>,
    known_lock: Mutex<()>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub fingerprint: String,
    pub key_type: String,
    pub status: String,
    pub previous_fingerprint: Option<String>,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEvent {
    pub kind: String,
    pub data: Option<String>,
    pub code: Option<i32>,
}
const MAX_SSH_INPUT: usize = 1024 * 1024;
const SSH_WRITE_CHUNK: usize = 16 * 1024;
#[derive(Default)]
struct QueuedInput {
    chunks: VecDeque<Vec<u8>>,
    bytes: usize,
}
#[derive(Default)]
struct TerminalControl {
    input: Mutex<QueuedInput>,
    close: AtomicBool,
    write_stalled: AtomicBool,
    interrupt: AtomicBool,
    ack: AtomicUsize,
    resize: Mutex<Option<(u32, u32)>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    pub name: String,
    pub folder: bool,
    pub symlink: bool,
    pub size: u64,
    pub modified: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Directory {
    pub path: String,
    pub files: Vec<RemoteFile>,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferEvent {
    pub id: String,
    pub name: String,
    pub transferred: u64,
    pub total: u64,
    pub status: String,
}
fn state() -> &'static SshState {
    static STATE: OnceLock<SshState> = OnceLock::new();
    STATE.get_or_init(SshState::default)
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn expand(path: &str) -> PathBuf {
    if path == "~" {
        PathBuf::from(std::env::var("HOME").unwrap_or_default())
    } else if let Some(rest) = path.strip_prefix("~/") {
        PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(rest)
    } else {
        PathBuf::from(path)
    }
}
fn validate(target: &Target) -> Result<()> {
    if target.host.is_empty()
        || target
            .host
            .chars()
            .any(|c| c.is_whitespace() || c == '/' || c == '\0')
        || target.port == 0
        || target.user.is_empty()
    {
        return Err("主机、用户名或端口无效".into());
    }
    if !["key", "password", "agent"].contains(&target.auth.as_str()) {
        return Err("不支持的认证方式".into());
    }
    Ok(())
}
fn handshake(target: &Target) -> Result<Session> {
    validate(target)?;
    let addresses = (target.host.as_str(), target.port)
        .to_socket_addrs()
        .map_err(error)?;
    let mut connected = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, Duration::from_secs(8)) {
            Ok(stream) => {
                connected = Some(stream);
                break;
            }
            Err(e) => {
                if connected.is_none() {
                    let _ = e;
                }
            }
        }
    }
    let tcp = connected.ok_or_else(|| "连接失败：目标拒绝连接或连接超时".to_string())?;
    tcp.set_read_timeout(Some(Duration::from_secs(15)))
        .map_err(error)?;
    tcp.set_write_timeout(Some(Duration::from_secs(15)))
        .map_err(error)?;
    let mut session = Session::new().map_err(error)?;
    session.set_tcp_stream(tcp);
    session.set_timeout(15000);
    session.handshake().map_err(error)?;
    Ok(session)
}
fn fingerprint(session: &Session) -> Result<(String, String)> {
    let (bytes, kind) = session.host_key().ok_or("服务器未提供主机密钥")?;
    Ok((
        format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(bytes))),
        format!("{:?}", kind),
    ))
}
fn known_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_data_dir().map_err(error)?;
    fs::create_dir_all(&dir).map_err(error)?;
    Ok(dir.join("ssh-known-hosts.json"))
}
fn known(app: &tauri::AppHandle) -> Result<HashMap<String, String>> {
    let path = known_path(app)?;
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(error),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(error(e)),
    }
}
fn host_id(target: &Target) -> String {
    format!("[{}]:{}", target.host.to_lowercase(), target.port)
}
fn verify(session: &Session, target: &Target, app: &tauri::AppHandle) -> Result<()> {
    let _lock = state().known_lock.lock().map_err(error)?;
    let (actual, _) = fingerprint(session)?;
    check_fingerprint(
        known(app)?.get(&host_id(target)).map(String::as_str),
        &actual,
    )
}
fn check_fingerprint(saved: Option<&str>, actual: &str) -> Result<()> {
    match saved {
        Some(saved) if saved == actual => Ok(()),
        Some(_) => Err("主机指纹已变化，已拒绝连接。请先核实服务器身份。".into()),
        None => Err("尚未信任此服务器，请先验证并确认主机指纹".into()),
    }
}
fn authenticate(session: &Session, target: &Target, credentials: &Credentials) -> Result<()> {
    match target.auth.as_str() {
        "password" => session
            .userauth_password(
                &target.user,
                credentials
                    .password
                    .as_deref()
                    .ok_or("请输入密码，或将凭据保存到本机")?,
            )
            .map_err(error)?,
        "agent" => session.userauth_agent(&target.user).map_err(error)?,
        "key" => {
            let path = expand(
                target
                    .private_key_path
                    .as_deref()
                    .filter(|p| !p.is_empty())
                    .unwrap_or("~/.ssh/id_ed25519"),
            );
            session
                .userauth_pubkey_file(&target.user, None, &path, credentials.passphrase.as_deref())
                .map_err(error)?;
        }
        _ => return Err("不支持的认证方式".into()),
    }
    if !session.authenticated() {
        return Err("SSH 认证失败".into());
    }
    Ok(())
}
fn resolve_credentials(path: &Path, id: &str, credentials: Option<Credentials>) -> Result<Credentials> {
    match credentials {
        Some(value) => Ok(value),
        None => crate::ssh_credentials::read_at(path, id),
    }
}
fn connection(id: &str) -> Result<Connection> {
    state()
        .connections
        .lock()
        .map_err(error)?
        .get(id)
        .cloned()
        .ok_or_else(|| "SSH 连接已断开，请重新连接".into())
}
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(error)?
}
#[tauri::command]
pub async fn ssh_host_info(target: Target, app: tauri::AppHandle) -> Result<HostInfo> {
    blocking(move || {
        let session = handshake(&target)?;
        let (fp, key_type) = fingerprint(&session)?;
        let _lock = state().known_lock.lock().map_err(error)?;
        let previous = known(&app)?.get(&host_id(&target)).cloned();
        let status = match &previous {
            None => "unknown",
            Some(p) if p == &fp => "trusted",
            Some(_) => "changed",
        };
        Ok(HostInfo {
            fingerprint: fp,
            key_type,
            status: status.into(),
            previous_fingerprint: previous,
        })
    })
    .await
}
#[tauri::command]
pub async fn ssh_trust_host(
    target: Target,
    fingerprint: String,
    expected_previous_fingerprint: Option<String>,
    app: tauri::AppHandle,
) -> Result<()> {
    blocking(move || {
        let session = handshake(&target)?;
        let (actual, _) = self::fingerprint(&session)?;
        if fingerprint != actual {
            return Err("核验期间主机指纹再次变化，已拒绝信任".into());
        }
        let _lock = state().known_lock.lock().map_err(error)?;
        let mut hosts = known(&app)?;
        if let Some(old) = hosts.get(&host_id(&target)) {
            if old != &actual && expected_previous_fingerprint.as_ref() != Some(old) {
                return Err("主机指纹已变化，需要核验旧指纹并明确确认替换".into());
            }
        } else if expected_previous_fingerprint.is_some() {
            return Err("信任记录已变化，请重新核验".into());
        }
        hosts.insert(host_id(&target), actual);
        let path = known_path(&app)?;
        let temp = path.with_extension("tmp");
        fs::write(&temp, serde_json::to_vec_pretty(&hosts).map_err(error)?).map_err(error)?;
        fs::rename(temp, path).map_err(error)?;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn ssh_save_credentials(server_id: String, credentials: Credentials, app: tauri::AppHandle) -> Result<()> {
    blocking(move || crate::ssh_credentials::save_at(&crate::ssh_credentials::path(&app)?, server_id, credentials)).await
}
#[tauri::command]
pub async fn ssh_delete_credentials(server_id: String, app: tauri::AppHandle) -> Result<()> {
    blocking(move || crate::ssh_credentials::delete_at(&crate::ssh_credentials::path(&app)?, &server_id)).await
}
#[tauri::command]
pub async fn ssh_has_credentials(server_id: String, app: tauri::AppHandle) -> Result<bool> {
    blocking(move || {
        let credentials = crate::ssh_credentials::read_at(&crate::ssh_credentials::path(&app)?, &server_id)?;
        Ok(credentials.password.is_some() || credentials.passphrase.is_some())
    }).await
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub home: String,
    pub sftp_available: bool,
}
// A server may intentionally disable SFTP while allowing an interactive SSH shell.
// Capability probing must never turn a successful SSH authentication into a failure.
fn finish_connection(
    session: Session,
    target: Target,
    credentials: Credentials,
    test_only: bool,
) -> Result<ConnectionInfo> {
    authenticate(&session, &target, &credentials)?;
    let (home, sftp_available) = match session.sftp() {
        Ok(sftp) => (
            sftp.realpath(Path::new("."))
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_else(|_| "~".into()),
            true,
        ),
        Err(_) => ("~".into(), false),
    };
    if !test_only {
        state().connections.lock().map_err(error)?.insert(
            target.id.clone(),
            Connection {
                session,
                target,
                credentials,
            },
        );
    }
    Ok(ConnectionInfo {
        home,
        sftp_available,
    })
}
// Resolve local credentials before opening the remote session. Host verification
// still pins the freshly opened session immediately before authentication.
fn connect_after_credentials(
    target: Target,
    resolve: impl FnOnce() -> Result<Credentials>,
    verify_host: impl FnOnce(&Session) -> Result<()>,
    test_only: bool,
) -> Result<ConnectionInfo> {
    let credentials = resolve()?;
    let session = handshake(&target)?;
    verify_host(&session)?;
    finish_connection(session, target, credentials, test_only)
}
#[tauri::command]
pub async fn ssh_connect(
    target: Target,
    credentials: Option<Credentials>,
    test_only: bool,
    app: tauri::AppHandle,
) -> Result<ConnectionInfo> {
    blocking(move || {
        let id = target.id.clone();
        let pinned_target = target.clone();
        let credentials_path = crate::ssh_credentials::path(&app)?;
        let agent_auth = target.auth == "agent";
        connect_after_credentials(
            target,
            move || if agent_auth { Ok(Credentials::default()) } else { resolve_credentials(&credentials_path, &id, credentials) },
            |session| verify(session, &pinned_target, &app),
            test_only,
        )
    })
    .await
}
#[tauri::command]
pub fn ssh_disconnect(server_id: String) -> Result<()> {
    if let Some(connection) = state()
        .connections
        .lock()
        .map_err(error)?
        .remove(&server_id)
    {
        let _ = connection
            .session
            .disconnect(None, "Portside disconnect", None);
    }
    Ok(())
}
#[tauri::command]
pub async fn ssh_terminal_open(
    session_id: String,
    server_id: String,
    cols: u32,
    rows: u32,
    directory: String,
    on_event: Channel<TerminalEvent>,
    app: tauri::AppHandle,
) -> Result<()> {
    blocking(move || {
        let connection = connection(&server_id)?;
        let session = handshake(&connection.target)?;
        verify(&session, &connection.target, &app)?;
        authenticate(&session, &connection.target, &connection.credentials)?;
        start_terminal(session, session_id, cols, rows, directory, on_event)
    })
    .await
}
fn start_terminal(
    session: Session,
    session_id: String,
    cols: u32,
    rows: u32,
    directory: String,
    on_event: Channel<TerminalEvent>,
) -> Result<()> {
    let mut channel = session.channel_session().map_err(error)?;
    channel
        .request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
        .map_err(error)?;
    channel.shell().map_err(error)?;
    if !directory.is_empty() && directory != "~" {
        let dir = if directory.starts_with("~/") {
            format!("\"$HOME\"/{}", shell_quote(&directory[2..]))
        } else {
            shell_quote(&directory)
        };
        channel
            .write_all(format!("cd -- {}\r", dir).as_bytes())
            .map_err(error)?;
    }
    session.set_blocking(false);
    let controls = Arc::new(TerminalControl::default());
    state()
        .terminals
        .lock()
        .map_err(error)?
        .insert(session_id.clone(), controls.clone());
    std::thread::spawn(move || {
        let mut pending = Vec::new();
        // Retry the same nonblocking libssh2 write buffer on EAGAIN. A priority
        // interrupt can discard queued chunks, but cannot replace an in-flight SSH packet.
        let mut input = Vec::new();
        let mut input_offset = 0usize;
        let mut buffer = [0u8; 32768];
        let mut outstanding = 0usize;
        loop {
            if controls.close.load(Ordering::Acquire) {
                break;
            }
            outstanding = outstanding.saturating_sub(controls.ack.swap(0, Ordering::AcqRel));
            if input.is_empty() {
                if controls.interrupt.swap(false, Ordering::AcqRel) {
                    input.push(3);
                } else if let Ok(mut queued) = controls.input.lock() {
                    if let Some(chunk) = queued.chunks.pop_front() {
                        queued.bytes -= chunk.len();
                        input = chunk;
                    }
                }
                input_offset = 0;
            }
            if !input.is_empty() {
                match channel.write(&input[input_offset..]) {
                    Ok(n) => {
                        controls.write_stalled.store(false, Ordering::Relaxed);
                        input_offset += n;
                        if input_offset == input.len() {
                            input.clear();
                            input_offset = 0;
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        controls.write_stalled.store(true, Ordering::Relaxed);
                    }
                    Err(e) => {
                        let _ = on_event.send(TerminalEvent {
                            kind: "error".into(),
                            data: Some(e.to_string()),
                            code: None,
                        });
                        break;
                    }
                }
            }
            // Resize is coalesced outside the data queue. EAGAIN retains the latest
            // requested geometry, rather than starving close/interrupt controls.
            let resize = controls
                .resize
                .lock()
                .ok()
                .and_then(|mut value| value.take());
            if let Some((cols, rows)) = resize {
                if let Err(e) = channel.request_pty_size(cols, rows, None, None) {
                    if e.code() == ssh2::ErrorCode::Session(-37) {
                        if let Ok(mut value) = controls.resize.lock() {
                            if value.is_none() {
                                *value = Some((cols, rows));
                            }
                        }
                    }
                }
            }
            if outstanding >= 262144 {
                std::thread::sleep(Duration::from_millis(8));
                continue;
            }
            match channel.read(&mut buffer) {
                Ok(0) if channel.eof() => break,
                Ok(n) => {
                    pending.extend_from_slice(&buffer[..n]);
                    let valid = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) => e.valid_up_to(),
                    };
                    if valid > 0 {
                        let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
                        outstanding += text.len();
                        pending.drain(..valid);
                        if on_event
                            .send(TerminalEvent {
                                kind: "data".into(),
                                data: Some(text),
                                code: None,
                            })
                            .is_err()
                        {
                            break;
                        }
                    }
                    if pending.len() > 8 {
                        let text = String::from_utf8_lossy(&pending).into_owned();
                        outstanding += text.len();
                        pending.clear();
                        let _ = on_event.send(TerminalEvent {
                            kind: "data".into(),
                            data: Some(text),
                            code: None,
                        });
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => {
                    let _ = on_event.send(TerminalEvent {
                        kind: "error".into(),
                        data: Some(e.to_string()),
                        code: None,
                    });
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(8));
        }
        if !pending.is_empty() {
            let _ = on_event.send(TerminalEvent {
                kind: "data".into(),
                data: Some(String::from_utf8_lossy(&pending).into_owned()),
                code: None,
            });
        }
        let code = channel.exit_status().unwrap_or(-1);
        let _ = channel.close();
        let _ = session.disconnect(None, "Terminal closed", None);
        let _ = on_event.send(TerminalEvent {
            kind: "exit".into(),
            data: None,
            code: Some(code),
        });
        if let Ok(mut terminals) = state().terminals.lock() {
            terminals.remove(&session_id);
        }
    });
    Ok(())
}

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn terminal_control(id: &str) -> Result<Arc<TerminalControl>> {
    state()
        .terminals
        .lock()
        .map_err(error)?
        .get(id)
        .cloned()
        .ok_or_else(|| "远程终端已关闭".into())
}
#[tauri::command]
pub fn ssh_terminal_write(session_id: String, data: String) -> Result<()> {
    if data.len() > MAX_SSH_INPUT {
        return Err("一次粘贴的内容过大，请分段发送".into());
    }
    let controls = terminal_control(&session_id)?;
    if controls.close.load(Ordering::Acquire) {
        return Err("远程终端已关闭".into());
    }
    let mut queued = controls.input.lock().map_err(error)?;
    if data == "\u{3}" {
        queued.chunks.clear();
        queued.bytes = 0;
        controls.interrupt.store(true, Ordering::Release);
        return Ok(());
    }
    if queued.bytes + data.len() > MAX_SSH_INPUT {
        return Err("终端输入队列已满，请稍后重试；Ctrl+C 或关闭会话仍可用".into());
    }
    queued.bytes += data.len();
    queued
        .chunks
        .extend(data.as_bytes().chunks(SSH_WRITE_CHUNK).map(<[u8]>::to_vec));
    Ok(())
}
#[tauri::command]
pub fn ssh_terminal_ack(session_id: String, bytes: usize) -> Result<()> {
    let controls = terminal_control(&session_id)?;
    let _ = controls
        .ack
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
            Some(n.saturating_add(bytes))
        });
    Ok(())
}
#[tauri::command]
pub fn ssh_terminal_resize(session_id: String, cols: u32, rows: u32) -> Result<()> {
    let controls = terminal_control(&session_id)?;
    *controls.resize.lock().map_err(error)? = Some((cols, rows));
    Ok(())
}
#[tauri::command]
pub fn ssh_terminal_close(session_id: String) -> Result<()> {
    if let Ok(controls) = terminal_control(&session_id) {
        controls.close.store(true, Ordering::Release);
    }
    Ok(())
}
#[tauri::command]
pub async fn ssh_list(server_id: String, path: String) -> Result<Directory> {
    blocking(move || {
        let conn = connection(&server_id)?;
        let sftp = conn.session.sftp().map_err(error)?;
        let path = sftp.realpath(Path::new(&path)).map_err(error)?;
        let mut files = Vec::new();
        for (file, stat) in sftp.readdir(&path).map_err(error)? {
            let name = file
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            if name == "." || name == ".." {
                continue;
            }
            let folder = stat.is_dir()
                || stat.file_type().is_symlink()
                    && sftp.stat(&file).map(|s| s.is_dir()).unwrap_or(false);
            files.push(RemoteFile {
                name,
                folder,
                symlink: stat.file_type().is_symlink(),
                size: stat.size.unwrap_or(0),
                modified: stat.mtime.unwrap_or(0),
            });
        }
        files.sort_by(|a, b| {
            b.folder
                .cmp(&a.folder)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(Directory {
            path: path.to_string_lossy().into_owned(),
            files,
        })
    })
    .await
}
fn valid_name(name: &str) -> Result<()> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\0') {
        Err("文件名无效".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub async fn ssh_file_action(
    server_id: String,
    path: String,
    action: String,
    name: Option<String>,
) -> Result<()> {
    blocking(move || {
        let conn = connection(&server_id)?;
        let sftp = conn.session.sftp().map_err(error)?;
        if (path == "/" && action != "mkdir") || path.is_empty() {
            return Err("不能操作根目录".into());
        }
        match action.as_str() {
            "mkdir" => {
                let name = name.ok_or("缺少名称")?;
                valid_name(&name)?;
                sftp.mkdir(&Path::new(&path).join(name), 0o755)
                    .map_err(error)
            }
            "rename" => {
                let name = name.ok_or("缺少名称")?;
                valid_name(&name)?;
                let dest = Path::new(&path).parent().ok_or("无效路径")?.join(name);
                if sftp.lstat(&dest).is_ok() {
                    return Err("同名文件已存在".into());
                }
                sftp.rename(Path::new(&path), &dest, Some(ssh2::RenameFlags::NATIVE))
                    .map_err(error)
            }
            "delete" => {
                let stat = sftp.lstat(Path::new(&path)).map_err(error)?;
                if stat.is_dir() {
                    sftp.rmdir(Path::new(&path)).map_err(error)
                } else {
                    sftp.unlink(Path::new(&path)).map_err(error)
                }
            }
            _ => Err("未知文件操作".into()),
        }
    })
    .await
}
#[tauri::command]
pub fn ssh_transfer_cancel(transfer_id: String) -> Result<()> {
    if let Some(cancel) = state().transfers.lock().map_err(error)?.get(&transfer_id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}
#[tauri::command]
pub async fn ssh_pick_upload() -> Result<Vec<String>> {
    blocking(|| {
        Ok(rfd::FileDialog::new()
            .set_title("选择上传文件")
            .pick_files()
            .unwrap_or_default()
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect())
    })
    .await
}
#[tauri::command]
pub async fn ssh_pick_download(name: String) -> Result<Option<String>> {
    blocking(move || {
        Ok(rfd::FileDialog::new()
            .set_title("保存远程文件")
            .set_file_name(&name)
            .save_file()
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}
#[tauri::command]
pub async fn ssh_transfer(
    server_id: String,
    transfer_id: String,
    local_path: String,
    remote_path: String,
    upload: bool,
    overwrite: bool,
    on_progress: Channel<TransferEvent>,
) -> Result<()> {
    let cancel = Arc::new(AtomicBool::new(false));
    state()
        .transfers
        .lock()
        .map_err(error)?
        .insert(transfer_id.clone(), cancel.clone());
    let id = transfer_id.clone();
    let result = blocking(move || {
        let conn = connection(&server_id)?;
        let session = handshake(&conn.target)?;
        if fingerprint(&session)?.0 != fingerprint(&conn.session)?.0 {
            return Err("传输连接主机指纹变化，已拒绝传输".into());
        }
        authenticate(&session, &conn.target, &conn.credentials)?;
        let sftp = session.sftp().map_err(error)?;
        let remote = Path::new(&remote_path);
        let local = Path::new(&local_path);
        let name = remote
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let total = if upload {
            fs::metadata(local).map_err(error)?.len()
        } else {
            sftp.stat(remote).map_err(error)?.size.unwrap_or(0)
        };
        if upload && !overwrite && sftp.lstat(remote).is_ok() {
            return Err("远程同名文件已存在".into());
        }
        if !upload && !overwrite && local.exists() {
            return Err("本地同名文件已存在".into());
        }
        let suffix = format!(
            ".portside-{}.part",
            id.chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect::<String>()
        );
        let remote_temp = PathBuf::from(format!("{}{}", remote_path, suffix));
        let local_temp = PathBuf::from(format!("{}{}", local_path, suffix));
        let mut source: Box<dyn Read> = if upload {
            Box::new(fs::File::open(local).map_err(error)?)
        } else {
            Box::new(sftp.open(remote).map_err(error)?)
        };
        let mut dest: Box<dyn Write> = if upload {
            Box::new(
                sftp.open_mode(
                    &remote_temp,
                    ssh2::OpenFlags::WRITE | ssh2::OpenFlags::CREATE | ssh2::OpenFlags::EXCLUSIVE,
                    0o600,
                    ssh2::OpenType::File,
                )
                .map_err(error)?,
            )
        } else {
            Box::new(
                fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&local_temp)
                    .map_err(error)?,
            )
        };
        let copied = (|| {
            let mut transferred = 0u64;
            let mut last_progress = std::time::Instant::now() - Duration::from_secs(1);
            let mut buf = [0u8; 65536];
            loop {
                if cancel.load(Ordering::Relaxed) {
                    return Err("传输已取消".into());
                }
                let n = source.read(&mut buf).map_err(error)?;
                if n == 0 {
                    break;
                }
                dest.write_all(&buf[..n]).map_err(error)?;
                transferred += n as u64;
                if last_progress.elapsed() >= Duration::from_millis(80) {
                    let _ = on_progress.send(TransferEvent {
                        id: id.clone(),
                        name: name.clone(),
                        transferred,
                        total,
                        status: "running".into(),
                    });
                    last_progress = std::time::Instant::now();
                }
            }
            dest.flush().map_err(error)?;
            Ok(())
        })();
        drop(dest);
        drop(source);
        if copied.is_err() {
            if upload {
                let _ = sftp.unlink(&remote_temp);
            } else {
                let _ = fs::remove_file(&local_temp);
            }
            return copied;
        }
        if cancel.load(Ordering::Relaxed) {
            if upload {
                let _ = sftp.unlink(&remote_temp);
            } else {
                let _ = fs::remove_file(&local_temp);
            }
            return Err("传输已取消".into());
        }
        if upload {
            if !overwrite && sftp.lstat(remote).is_ok() {
                let _ = sftp.unlink(&remote_temp);
                return Err("目标已出现同名文件，未覆盖".into());
            }
            // SFTP v3 servers (including OpenSSH) may reject overwrite rename.
            // Preserve the old entry as a backup until the staged file is committed.
            let existing = sftp.lstat(remote).ok();
            let backup = PathBuf::from(format!("{}{}.backup", remote_path, suffix));
            let backed_up = if overwrite {
                if let Some(stat) = existing {
                    if stat.is_dir() {
                        let _ = sftp.unlink(&remote_temp);
                        return Err("目标是目录，不能用文件覆盖".into());
                    }
                    if sftp.lstat(&backup).is_ok() {
                        let _ = sftp.unlink(&remote_temp);
                        return Err("传输备份文件已存在，请刷新目录后重试".into());
                    }
                    if let Err(e) = sftp.rename(remote, &backup, Some(ssh2::RenameFlags::empty())) {
                        let _ = sftp.unlink(&remote_temp);
                        return Err(error(e));
                    }
                    true
                } else {
                    false
                }
            } else {
                false
            };
            if let Err(e) = sftp.rename(&remote_temp, remote, Some(ssh2::RenameFlags::empty())) {
                let _ = sftp.unlink(&remote_temp);
                if backed_up {
                    if sftp
                        .rename(&backup, remote, Some(ssh2::RenameFlags::empty()))
                        .is_err()
                    {
                        return Err(format!(
                            "上传失败，原文件保留在 {}，请刷新目录核实：{}",
                            backup.display(),
                            e
                        ));
                    }
                }
                return Err(error(e));
            }
            if backed_up {
                if let Err(e) = sftp.unlink(&backup) {
                    return Err(format!(
                        "新文件已上传；旧文件备份 {} 无法移除：{}",
                        backup.display(),
                        e
                    ));
                }
            }
        } else {
            if !overwrite && local.exists() {
                let _ = fs::remove_file(&local_temp);
                return Err("本地目标已出现同名文件，未覆盖".into());
            }
            let moved = if overwrite {
                fs::rename(&local_temp, local)
            } else {
                fs::hard_link(&local_temp, local).and_then(|_| fs::remove_file(&local_temp))
            };
            if let Err(e) = moved {
                let _ = fs::remove_file(&local_temp);
                return Err(error(e));
            }
        }
        let _ = on_progress.send(TransferEvent {
            id: id.clone(),
            name,
            transferred: total,
            total,
            status: "completed".into(),
        });
        Ok(())
    })
    .await;
    state()
        .transfers
        .lock()
        .map_err(error)?
        .remove(&transfer_id);
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_credential_wait_does_not_open_remote_tcp() {
        use std::{net::TcpListener, sync::mpsc, time::Instant};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (waiting_tx, waiting_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            connect_after_credentials(
                Target {
                    id: "local-storage-order-test".into(),
                    host: "127.0.0.1".into(),
                    user: "tester".into(),
                    port,
                    auth: "password".into(),
                    private_key_path: None,
                },
                || {
                    waiting_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    Err("local authorization cancelled".into())
                },
                |_| panic!("no remote session may exist before credentials resolve"),
                true,
            )
        });
        waiting_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let until = Instant::now() + Duration::from_millis(100);
        while Instant::now() < until {
            assert_eq!(
                listener.accept().unwrap_err().kind(),
                std::io::ErrorKind::WouldBlock
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        release_tx.send(()).unwrap();
        assert_eq!(
            worker.join().unwrap().err().unwrap(),
            "local authorization cancelled"
        );
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
    #[test]
    fn quotes() {
        assert_eq!(shell_quote("hello ' world"), "'hello '\\'' world'");
    }
    #[test]
    fn reject_names() {
        for name in ["", ".", "..", "a/b", "a\0b"] {
            assert!(valid_name(name).is_err());
        }
        assert!(valid_name("中文 文件").is_ok());
    }
    #[test]
    fn host_validation() {
        let t = Target {
            id: "a".into(),
            host: "127.0.0.1".into(),
            user: "test".into(),
            port: 22,
            auth: "agent".into(),
            private_key_path: None,
        };
        assert!(validate(&t).is_ok());
        let mut bad = t;
        bad.host = "host; touch /tmp/foo".into();
        assert!(validate(&bad).is_err());
    }
}

pub fn close_all() {
    if let Ok(mut terminals) = state().terminals.lock() {
        for (_, tx) in terminals.drain() {
            tx.close.store(true, Ordering::Release);
        }
    }
    if let Ok(mut transfers) = state().transfers.lock() {
        for (_, cancel) in transfers.drain() {
            cancel.store(true, Ordering::Relaxed);
        }
    }
    if let Ok(mut connections) = state().connections.lock() {
        for (_, conn) in connections.drain() {
            let _ = conn.session.disconnect(None, "Application exit", None);
        }
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    use std::{
        sync::{atomic::AtomicUsize, mpsc},
        time::Instant,
    };
    fn fixture_target() -> Target {
        Target {
            id: "portside-fixture-rust".into(),
            host: "127.0.0.1".into(),
            port: std::env::var("PORTSIDE_SSH_FIXTURE_PORT")
                .unwrap_or("22291".into())
                .parse()
                .unwrap(),
            user: "tester".into(),
            auth: "password".into(),
            private_key_path: None,
        }
    }
    fn password() -> Credentials {
        Credentials {
            password: Some("fixture-password".into()),
            passphrase: None,
        }
    }
    fn connect_fixture(target: &Target, credentials: &Credentials) -> Session {
        let session = handshake(target).expect("fixture TCP/SSH handshake");
        authenticate(&session, target, credentials).expect("fixture SSH authenticate");
        session
    }
    #[test]
    #[ignore = "Requires isolated SSH fixture"]
    fn saved_local_plaintext_authenticates_and_deletion_revokes_restore() {
        let target = fixture_target();
        let root = std::env::temp_dir().join(format!("portside-local-auth-{}", std::process::id()));
        struct Cleanup(PathBuf);
        impl Drop for Cleanup { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
        let _cleanup = Cleanup(root.clone());
        let path = root.join("ssh-credentials.json");
        crate::ssh_credentials::save_at(&path, target.id.clone(), password()).unwrap();
        assert!(fs::read_to_string(&path).unwrap().contains("fixture-password"));
        let loaded = resolve_credentials(&path, &target.id, None).unwrap();
        let session = connect_fixture(&target, &loaded);
        let mut channel = session.channel_session().unwrap();
        channel.exec("printf LOCAL_CREDENTIAL_RESTORED").unwrap();
        let mut output = String::new(); channel.read_to_string(&mut output).unwrap();
        assert_eq!(output, "LOCAL_CREDENTIAL_RESTORED");
        channel.wait_close().unwrap();
        crate::ssh_credentials::delete_at(&path, &target.id).unwrap();
        let removed = resolve_credentials(&path, &target.id, None).unwrap();
        assert!(removed.password.is_none());
        assert!(authenticate(&handshake(&target).unwrap(), &target, &removed).is_err());
    }
    fn event_body(body: tauri::ipc::InvokeResponseBody) -> String {
        match body {
            tauri::ipc::InvokeResponseBody::Json(json) => json,
            tauri::ipc::InvokeResponseBody::Raw(bytes) => {
                String::from_utf8_lossy(&bytes).into_owned()
            }
        }
    }
    #[test]
    #[ignore = "Requires the isolated Docker SSH fixture; run with PORTSIDE_SSH_FIXTURE_PORT=22291"]
    fn ssh_fixture_end_to_end() {
        let target = fixture_target();
        let creds = password();
        let session = connect_fixture(&target, &creds);
        let (fp, kind) = fingerprint(&session).unwrap();
        assert!(fp.starts_with("SHA256:"));
        assert!(!kind.is_empty());
        assert!(check_fingerprint(None, &fp).is_err());
        assert!(check_fingerprint(Some(&fp), &fp).is_ok());
        assert!(check_fingerprint(Some("SHA256:other"), &fp)
            .unwrap_err()
            .contains("变化"));
        let bad = handshake(&target).unwrap();
        assert!(authenticate(
            &bad,
            &target,
            &Credentials {
                password: Some("wrong-password".into()),
                passphrase: None
            }
        )
        .is_err());
        let mut key_target = target.clone();
        key_target.auth = "key".into();
        key_target.private_key_path = Some(
            fixture_root()
                .join("id_ed25519")
                .to_string_lossy()
                .into_owned(),
        );
        let key_session = connect_fixture(&key_target, &Credentials::default());
        assert!(key_session.authenticated());
        let mut missing = key_target.clone();
        missing.private_key_path = Some(
            fixture_root()
                .join("does-not-exist")
                .to_string_lossy()
                .into_owned(),
        );
        assert!(authenticate(
            &handshake(&missing).unwrap(),
            &missing,
            &Credentials::default()
        )
        .is_err());
        state().connections.lock().unwrap().insert(
            target.id.clone(),
            Connection {
                session: session.clone(),
                target: target.clone(),
                credentials: creds.clone(),
            },
        );
        use tauri::async_runtime::block_on as run;
        let root = format!("/home/tester/portside-qa-{}", std::process::id());
        let sftp = session.sftp().unwrap();
        sftp.mkdir(Path::new(&root), 0o700).unwrap();
        let listed = run(ssh_list(target.id.clone(), root.clone())).unwrap();
        assert!(listed.files.is_empty());
        assert_eq!(listed.path, root);
        run(ssh_file_action(
            target.id.clone(),
            root.clone(),
            "mkdir".into(),
            Some("中文 目录".into()),
        ))
        .unwrap();
        let files = run(ssh_list(target.id.clone(), root.clone()))
            .unwrap()
            .files;
        assert_eq!(files.len(), 1);
        assert!(files[0].folder);
        run(ssh_file_action(
            target.id.clone(),
            format!("{root}/中文 目录"),
            "rename".into(),
            Some("renamed".into()),
        ))
        .unwrap();
        let local = std::env::temp_dir().join(format!("portside-ssh-qa-{}", std::process::id()));
        fs::create_dir_all(&local).unwrap();
        let upload = local.join("中文 upload.bin");
        let contents = (0..524288).map(|n| (n % 251) as u8).collect::<Vec<_>>();
        fs::write(&upload, &contents).unwrap();
        let remote = format!("{root}/中文 upload.bin");
        let progress = Arc::new(AtomicUsize::new(0));
        let count = progress.clone();
        run(ssh_transfer(
            target.id.clone(),
            "fixture-upload".into(),
            upload.to_string_lossy().into_owned(),
            remote.clone(),
            true,
            false,
            Channel::new(move |_| {
                count.fetch_add(1, Ordering::Relaxed);
                Ok(())
            }),
        ))
        .unwrap();
        assert!(progress.load(Ordering::Relaxed) > 0);
        // No overwrite without explicit confirmation; source and destination stay intact.
        assert!(run(ssh_transfer(
            target.id.clone(),
            "fixture-no-overwrite".into(),
            upload.to_string_lossy().into_owned(),
            remote.clone(),
            true,
            false,
            Channel::new(|_| Ok(()))
        ))
        .is_err());
        let download = local.join("download.bin");
        run(ssh_transfer(
            target.id.clone(),
            "fixture-download".into(),
            download.to_string_lossy().into_owned(),
            remote.clone(),
            false,
            false,
            Channel::new(|_| Ok(())),
        ))
        .unwrap();
        assert_eq!(fs::read(&download).unwrap(), contents);
        let big = local.join("cancel.bin");
        fs::write(&big, vec![19u8; 8 * 1024 * 1024]).unwrap();
        let cancelled_remote = format!("{root}/cancel.bin");
        let cancel_result = run(ssh_transfer(
            target.id.clone(),
            "fixture-cancel".into(),
            big.to_string_lossy().into_owned(),
            cancelled_remote.clone(),
            true,
            false,
            Channel::new(|_| {
                ssh_transfer_cancel("fixture-cancel".into()).unwrap();
                Ok(())
            }),
        ));
        assert!(cancel_result.unwrap_err().contains("取消"));
        assert!(sftp.lstat(Path::new(&cancelled_remote)).is_err());
        assert!(!sftp
            .readdir(Path::new(&root))
            .unwrap()
            .iter()
            .any(|(p, _)| p.to_string_lossy().contains(".part")));
        assert!(run(ssh_file_action(
            target.id.clone(),
            root.clone(),
            "delete".into(),
            None
        ))
        .is_err()); // non-empty folder is preserved
        assert!(run(ssh_file_action(
            target.id.clone(),
            root.clone(),
            "mkdir".into(),
            Some("../escape".into())
        ))
        .is_err());
        // The exact terminal worker used by the command: resize, Chinese UTF-8, Ctrl+C, long output and exit.
        let terminal_session = connect_fixture(&target, &creds);
        let id = "fixture-terminal".to_string();
        let ack_id = id.clone();
        let (tx, rx) = mpsc::channel();
        start_terminal(
            terminal_session,
            id.clone(),
            90,
            30,
            root.clone(),
            Channel::new(move |body| {
                let json = event_body(body);
                let event: TerminalEvent = serde_json::from_str(&json).unwrap();
                if event.kind == "data" {
                    if let Some(ref data) = event.data {
                        let _ = ssh_terminal_ack(ack_id.clone(), data.len());
                    }
                }
                tx.send(event).unwrap();
                Ok(())
            }),
        )
        .unwrap();
        ssh_terminal_resize(id.clone(), 100, 40).unwrap();
        ssh_terminal_write(id.clone(), "printf '中文验证\\n'; stty size; pwd\r".into()).unwrap();
        let mut output = String::new();
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if let Ok(event) = rx.recv_timeout(Duration::from_millis(500)) {
                if let Some(data) = event.data {
                    output.push_str(&data);
                }
                if output.contains("40 100")
                    && output.contains("中文验证")
                    && output.contains(&root)
                {
                    break;
                }
            }
        }
        assert!(output.contains("40 100"), "resize output: {output}");
        assert!(output.contains("中文验证"));
        assert!(output.contains(&root));
        ssh_terminal_write(id.clone(), "sleep 30\r".into()).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        ssh_terminal_write(id.clone(), "\u{3}".into()).unwrap();
        ssh_terminal_write(id.clone(), "printf 'AFTER_INTERRUPT\\n'\r".into()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Ok(event) = rx.recv_timeout(Duration::from_millis(200)) {
                if let Some(data) = event.data {
                    output.push_str(&data);
                }
                if output.contains("AFTER_INTERRUPT\r\n") {
                    break;
                }
            }
        }
        assert!(
            output.contains("AFTER_INTERRUPT\r\n"),
            "interrupt: {output}"
        );
        ssh_terminal_write(id.clone(), "exit 7\r".into()).unwrap();
        let mut exited = false;
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Ok(event) = rx.recv_timeout(Duration::from_millis(200)) {
                if event.kind == "exit" {
                    assert_eq!(event.code, Some(7));
                    exited = true;
                    break;
                }
            }
        }
        assert!(exited);
        assert!(!state().terminals.lock().unwrap().contains_key(&id));
        run(ssh_file_action(
            target.id.clone(),
            remote,
            "delete".into(),
            None,
        ))
        .unwrap();
        run(ssh_file_action(
            target.id.clone(),
            format!("{root}/renamed"),
            "delete".into(),
            None,
        ))
        .unwrap();
        run(ssh_file_action(
            target.id.clone(),
            root,
            "delete".into(),
            None,
        ))
        .unwrap();
        fs::remove_dir_all(local).unwrap();
        ssh_disconnect(target.id).unwrap();
        println!("SSH fixture passed: password/key authentication, auth failures, UTF8 PTY, resize/CtrlC/exit, SFTP mutations, byte-perfect upload/download, overwrite refusal, transfer cancellation and cleanup");
    }

}

#[cfg(test)]
mod extended_live_tests {
    use super::*;
    use std::{sync::atomic::AtomicUsize, time::Instant};
    fn target() -> Target {
        Target {
            id: "portside-fixture-extended".into(),
            host: "127.0.0.1".into(),
            port: std::env::var("PORTSIDE_SSH_FIXTURE_PORT")
                .unwrap_or("22291".into())
                .parse()
                .unwrap(),
            user: "tester".into(),
            auth: "key".into(),
            private_key_path: Some(
                fixture_root()
                    .join("id_ed25519")
                    .to_string_lossy()
                    .into_owned(),
            ),
        }
    }
    #[test]
    #[ignore = "Requires isolated Docker fixture, encrypted key, and isolated SSH_AUTH_SOCK"]
    fn encrypted_key_agent_backpressure_failures() {
        let target = target();
        let mut encrypted = target.clone();
        encrypted.private_key_path = Some(
            fixture_root()
                .join("id_encrypted")
                .to_string_lossy()
                .into_owned(),
        );
        let encrypted_session = handshake(&encrypted).unwrap();
        authenticate(
            &encrypted_session,
            &encrypted,
            &Credentials {
                password: None,
                passphrase: Some("fixture-passphrase".into()),
            },
        )
        .unwrap();
        assert!(encrypted_session.authenticated());
        let bad = handshake(&encrypted).unwrap();
        assert!(authenticate(
            &bad,
            &encrypted,
            &Credentials {
                password: None,
                passphrase: Some("wrong-passphrase".into())
            }
        )
        .is_err());
        assert!(
            std::env::var("SSH_AUTH_SOCK")
                .unwrap()
                .contains("portside-ssh-fixture"),
            "Never use the user's own SSH agent in this test"
        );
        let mut agent = target.clone();
        agent.auth = "agent".into();
        let agent_session = handshake(&agent).unwrap();
        authenticate(&agent_session, &agent, &Credentials::default()).unwrap();
        let session = handshake(&target).unwrap();
        authenticate(&session, &target, &Credentials::default()).unwrap();
        state().connections.lock().unwrap().insert(
            target.id.clone(),
            Connection {
                session: session.clone(),
                target: target.clone(),
                credentials: Credentials::default(),
            },
        );
        use tauri::async_runtime::block_on as run;
        assert!(run(ssh_list(target.id.clone(), "/root".into())).is_err());
        assert!(run(ssh_list(target.id.clone(), "/does-not-exist".into())).is_err());
        assert!(run(ssh_file_action(
            target.id.clone(),
            "/".into(),
            "delete".into(),
            None
        ))
        .is_err());
        let root = format!("/home/tester/portside-extended-{}", std::process::id());
        let sftp = session.sftp().unwrap();
        sftp.mkdir(Path::new(&root), 0o700).unwrap();
        let local = std::env::temp_dir().join(format!("portside-extended-{}", std::process::id()));
        fs::create_dir_all(&local).unwrap();
        let remote = Path::new(&root).join("big.bin");
        sftp.create(&remote)
            .unwrap()
            .write_all(&vec![123u8; 1024 * 1024])
            .unwrap();
        let download = local.join("cancel-download.bin");
        assert!(run(ssh_transfer(
            target.id.clone(),
            "fixture-cancel-download".into(),
            download.to_string_lossy().into_owned(),
            remote.to_string_lossy().into_owned(),
            false,
            false,
            Channel::new(|_| {
                ssh_transfer_cancel("fixture-cancel-download".into()).unwrap();
                Ok(())
            })
        ))
        .unwrap_err()
        .contains("取消"));
        assert!(!download.exists());
        assert!(fs::read_dir(&local).unwrap().next().is_none());
        let new_data = local.join("upload-new.bin");
        fs::write(&new_data, b"updated content").unwrap();
        run(ssh_transfer(
            target.id.clone(),
            "fixture-overwrite".into(),
            new_data.to_string_lossy().into_owned(),
            remote.to_string_lossy().into_owned(),
            true,
            true,
            Channel::new(|_| Ok(())),
        ))
        .unwrap();
        let mut actual = Vec::new();
        sftp.open(&remote)
            .unwrap()
            .read_to_end(&mut actual)
            .unwrap();
        assert_eq!(actual, b"updated content");
        let invalid = local.join("does-not-exist");
        assert!(run(ssh_transfer(
            target.id.clone(),
            "fixture-source-missing".into(),
            invalid.to_string_lossy().into_owned(),
            format!("{root}/missing.bin"),
            true,
            false,
            Channel::new(|_| Ok(()))
        ))
        .is_err());
        let worker_session = handshake(&target).unwrap();
        authenticate(&worker_session, &target, &Credentials::default()).unwrap();
        let bytes = Arc::new(AtomicUsize::new(0));
        let ack = Arc::new(AtomicBool::new(false));
        let exited = Arc::new(AtomicBool::new(false));
        let count = bytes.clone();
        let auto_ack = ack.clone();
        let done = exited.clone();
        let terminal_id = "fixture-backpressure".to_string();
        let callback_id = terminal_id.clone();
        start_terminal(
            worker_session,
            terminal_id.clone(),
            80,
            24,
            "/home/tester".into(),
            Channel::new(move |body| {
                let json = match body {
                    tauri::ipc::InvokeResponseBody::Json(json) => json,
                    _ => panic!(),
                };
                let event: TerminalEvent = serde_json::from_str(&json).unwrap();
                if event.kind == "data" {
                    let length = event.data.unwrap().len();
                    count.fetch_add(length, Ordering::Relaxed);
                    if auto_ack.load(Ordering::Relaxed) {
                        let _ = ssh_terminal_ack(callback_id.clone(), length);
                    }
                } else if event.kind == "exit" {
                    done.store(true, Ordering::Relaxed);
                }
                Ok(())
            }),
        )
        .unwrap();
        ssh_terminal_write(
            terminal_id.clone(),
            "head -c 1048576 /dev/zero | tr '\\0' 'x'; printf 'BACKPRESSURE_DONE\\n'; exit\r"
                .into(),
        )
        .unwrap();
        std::thread::sleep(Duration::from_secs(1));
        let blocked = bytes.load(Ordering::Relaxed);
        assert!(blocked >= 262144, "worker did not reach bound: {blocked}");
        assert!(blocked <= 262144 + 32768, "unbounded output: {blocked}");
        assert!(!exited.load(Ordering::Relaxed));
        ack.store(true, Ordering::Relaxed);
        ssh_terminal_ack(terminal_id.clone(), blocked).unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        while !exited.load(Ordering::Relaxed) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(exited.load(Ordering::Relaxed));
        assert!(bytes.load(Ordering::Relaxed) > 1024 * 1024);
        sftp.unlink(&remote).unwrap();
        sftp.rmdir(Path::new(&root)).unwrap();
        fs::remove_dir_all(local).unwrap();
        ssh_disconnect(target.id).unwrap();
        println!("SSH extended fixture passed: encrypted key success/failure, isolated agent, permission/missing file failures, download cancellation/cleanup, confirmed overwrite, 256KB backpressure and recovery");
    }
}

#[cfg(test)]
mod no_sftp_live_tests {
    use super::*;
    use std::{sync::mpsc, time::Instant};
    #[test]
    #[ignore = "Requires isolated SSH fixtures: 22291 with SFTP, 22292 without SFTP"]
    fn authenticated_shell_survives_disabled_sftp() {
        let target = Target {
            id: "portside-nosftp-fixture".into(),
            host: "127.0.0.1".into(),
            user: "tester".into(),
            port: std::env::var("PORTSIDE_SSH_NO_SFTP_PORT")
                .unwrap_or("22292".into())
                .parse()
                .unwrap(),
            auth: "password".into(),
            private_key_path: None,
        };
        let credentials = Credentials {
            password: Some("fixture-password".into()),
            passphrase: None,
        };
        let result = finish_connection(
            handshake(&target).unwrap(),
            target.clone(),
            credentials.clone(),
            false,
        )
        .unwrap();
        assert_eq!(result.home, "~");
        assert!(!result.sftp_available);
        let connection = connection(&target.id).unwrap();
        assert!(connection.session.authenticated());
        assert!(tauri::async_runtime::block_on(ssh_list(target.id.clone(), ".".into())).is_err());
        let wrong = finish_connection(
            handshake(&target).unwrap(),
            target.clone(),
            Credentials {
                password: Some("incorrect".into()),
                passphrase: None,
            },
            true,
        )
        .err()
        .unwrap();
        assert!(
            wrong.to_lowercase().contains("authentication"),
            "auth failure must remain an error: {wrong}"
        );
        let shell = handshake(&connection.target).unwrap();
        authenticate(&shell, &connection.target, &connection.credentials).unwrap();
        let (tx, rx) = mpsc::channel();
        let id = "fixture-shell-without-sftp".to_string();
        let ack_id = id.clone();
        start_terminal(
            shell,
            id.clone(),
            80,
            24,
            result.home,
            Channel::new(move |body| {
                let event: TerminalEvent = match body {
                    tauri::ipc::InvokeResponseBody::Json(json) => {
                        serde_json::from_str(&json).unwrap()
                    }
                    _ => panic!(),
                };
                if event.kind == "data" {
                    let _ = ssh_terminal_ack(ack_id.clone(), event.data.as_ref().unwrap().len());
                }
                tx.send(event).unwrap();
                Ok(())
            }),
        )
        .unwrap();
        ssh_terminal_write(id, "printf 'SSH_WITHOUT_SFTP\\n'; pwd; exit 0\r".into()).unwrap();
        let mut output = String::new();
        let mut exited = false;
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Ok(event) = rx.recv_timeout(Duration::from_millis(200)) {
                if let Some(data) = event.data {
                    output.push_str(&data)
                }
                if event.kind == "exit" {
                    assert_eq!(event.code, Some(0));
                    exited = true;
                    break;
                }
            }
        }
        assert!(exited);
        assert!(output.contains("SSH_WITHOUT_SFTP\r\n"));
        assert!(output.contains("/home/tester\r\n"));
        ssh_disconnect(target.id).unwrap();
        let normal = Target {
            id: "portside-sftp-capability-fixture".into(),
            port: std::env::var("PORTSIDE_SSH_FIXTURE_PORT")
                .unwrap_or("22291".into())
                .parse()
                .unwrap(),
            ..target
        };
        let result =
            finish_connection(handshake(&normal).unwrap(), normal, credentials, true).unwrap();
        assert_eq!(result.home, "/home/tester");
        assert!(result.sftp_available);
        println!("SSH no-SFTP fixture passed: authentication success yields home=~ / sftpAvailable=false; wrong password still errors; listing errors honestly; real interactive shell remains usable; normal SFTP capability stays true");
    }
}

#[cfg(test)]
fn fixture_root() -> PathBuf {
    std::env::var_os("PORTSIDE_SSH_FIXTURE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp/portside-ssh-fixture"))
}

#[cfg(test)]
mod input_pressure_live_tests {
    use super::*;
    use std::{sync::mpsc, time::Instant};
    #[test]
    #[ignore = "Requires isolated SSH fixture"]
    fn nonreading_remote_input_is_bounded_and_close_stays_responsive() {
        let target = Target {
            id: "ssh-input-pressure".into(),
            host: "127.0.0.1".into(),
            port: std::env::var("PORTSIDE_SSH_FIXTURE_PORT")
                .unwrap_or("22291".into())
                .parse()
                .unwrap(),
            user: "tester".into(),
            auth: "key".into(),
            private_key_path: Some(
                fixture_root()
                    .join("id_ed25519")
                    .to_string_lossy()
                    .into_owned(),
            ),
        };
        let session = handshake(&target).unwrap();
        authenticate(&session, &target, &Credentials::default()).unwrap();
        let id = "ssh-input-pressure".to_string();
        let ack_id = id.clone();
        let (tx, rx) = mpsc::channel();
        start_terminal(
            session,
            id.clone(),
            80,
            24,
            "~".into(),
            Channel::new(move |body| {
                let json = match body {
                    tauri::ipc::InvokeResponseBody::Json(json) => json,
                    _ => panic!(),
                };
                let event: TerminalEvent = serde_json::from_str(&json).unwrap();
                if event.kind == "data" {
                    let _ = ssh_terminal_ack(ack_id.clone(), event.data.as_ref().unwrap().len());
                }
                let _ = tx.send(event);
                Ok(())
            }),
        )
        .unwrap();
        ssh_terminal_write(id.clone(),"stty -echo -icanon min 1 time 0; printf 'REMOTE_NOT_READING\\n'; sleep 30; stty sane; printf 'REMOTE_RESUMED\\n'\r".into()).unwrap();
        let mut output = String::new();
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Ok(event) = rx.recv_timeout(Duration::from_millis(100)) {
                if let Some(data) = event.data {
                    output.push_str(&data)
                }
                if output.contains("REMOTE_NOT_READING\r\n") {
                    break;
                }
            }
        }
        assert!(output.contains("REMOTE_NOT_READING\r\n"));
        let controls = terminal_control(&id).unwrap();
        let payload = "x".repeat(128 * 1024);
        let mut refused = 0;
        let mut slowest = Duration::ZERO;
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            let start = Instant::now();
            if ssh_terminal_write(id.clone(), payload.clone()).is_err() {
                refused += 1;
            }
            slowest = slowest.max(start.elapsed());
            assert!(controls.input.lock().unwrap().bytes <= MAX_SSH_INPUT);
            if controls.write_stalled.load(Ordering::Relaxed) && refused > 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(refused > 0);
        assert!(
            slowest < Duration::from_millis(300),
            "write IPC blocked {slowest:?}"
        );
        assert!(
            controls.write_stalled.load(Ordering::Relaxed),
            "fixture never exhausted SSH write window"
        );
        let interrupt = Instant::now();
        ssh_terminal_write(id.clone(), "\u{3}".into()).unwrap();
        assert!(interrupt.elapsed() < Duration::from_millis(300));
        assert_eq!(controls.input.lock().unwrap().bytes, 0);
        // A remote SSH transport with a zero receive window may delay Ctrl+C itself.
        // It must never prevent this app from cancelling pending input or closing.
        let close = Instant::now();
        ssh_terminal_close(id.clone()).unwrap();
        assert!(close.elapsed() < Duration::from_millis(300));
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut exited = false;
        while Instant::now() < deadline {
            if let Ok(event) = rx.recv_timeout(Duration::from_millis(100)) {
                if event.kind == "exit" {
                    exited = true;
                    break;
                }
            }
        }
        assert!(exited, "closing SSH was blocked by a full input window");
        assert!(close.elapsed() < Duration::from_secs(2));
        assert!(!state().terminals.lock().unwrap().contains_key(&id));
        println!("SSH input-pressure passed: actual remote receive-window EAGAIN, bounded 1MB queue, {refused} immediate rejections, worst write {slowest:?}, priority Ctrl+C clears pending paste, close+worker exit {:?}",close.elapsed());
    }
}
