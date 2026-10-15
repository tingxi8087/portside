use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Condvar, Mutex,
    },
    thread,
};
use tauri::{ipc::Channel, State};

const INPUT_WINDOW: usize = 256 * 1024;
const OUTPUT_WINDOW: usize = 256 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEvent {
    pub kind: String,
    pub data: Option<Vec<u8>>,
    pub code: Option<u32>,
}
struct Flow {
    pending: usize,
    closed: bool,
}
struct PtySession {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    shell_pid: Option<i32>,
    input: mpsc::SyncSender<(usize, Vec<u8>)>,
    input_epoch: AtomicUsize,
    input_pending: AtomicUsize,
    exited: AtomicBool,
    flow: (Mutex<Flow>, Condvar),
}
#[derive(Default)]
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
}
impl TerminalManager {
    pub fn close_all(&self) {
        let entries = self
            .sessions
            .lock()
            .unwrap()
            .drain()
            .map(|(_, s)| s)
            .collect::<Vec<_>>();
        for session in entries {
            close(&session);
        }
    }
    fn get(&self, id: &str) -> Result<Arc<PtySession>, String> {
        self.sessions
            .lock()
            .map_err(|e| e.to_string())?
            .get(id)
            .cloned()
            .ok_or_else(|| "终端会话已关闭".into())
    }
}
fn close(session: &PtySession) {
    // Retain the child lock from the liveness check through all signals. A live
    // child (or unreaped zombie) pins its PID; an already reaped PID may belong
    // to an unrelated process and must never be signalled.
    let mut child = match session.child.lock() {
        Ok(child) => child,
        Err(_) => return,
    };
    let alive = matches!(child.try_wait(), Ok(None));
    let (flow, wake) = &session.flow;
    if let Ok(mut state) = flow.lock() {
        state.closed = true;
        wake.notify_all();
    }
    if !alive {
        session.master.lock().unwrap().take();
        if let Ok(mut writer) = session.writer.try_lock() {
            writer.take();
        }
        return;
    }
    // Include all job groups belonging to this PTY's POSIX session.
    if let Some(shell) = session.shell_pid {
        #[cfg(target_os = "macos")]
        unsafe {
            let capacity = libc::proc_listallpids(std::ptr::null_mut(), 0).max(0) as usize + 64;
            let mut pids = vec![0i32; capacity];
            let count = libc::proc_listallpids(
                pids.as_mut_ptr().cast(),
                (capacity * std::mem::size_of::<i32>()) as i32,
            )
            .max(0) as usize;
            for pid in pids.into_iter().take(count) {
                if pid > 1 && pid != shell && libc::getsid(pid) == shell {
                    libc::kill(pid, libc::SIGKILL);
                }
            }
        }
        unsafe {
            libc::kill(-shell, libc::SIGHUP);
        }
    }
    // try_wait never holds this lock while waiting for process termination.
    if let Some(pid) = session.shell_pid {
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
    session.master.lock().unwrap().take();
    if let Ok(mut writer) = session.writer.try_lock() {
        writer.take();
    }
    let _ = child.try_wait();
}
fn dimensions(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(2, 500),
        cols: cols.clamp(2, 1000),
        pixel_width: 0,
        pixel_height: 0,
    }
}
fn working_directory(directory: &str) -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "无法获取用户目录")?;
    let path = if directory.is_empty() || directory == "~" {
        home
    } else if let Some(rest) = directory.strip_prefix("~/") {
        format!("{home}/{rest}")
    } else {
        directory.to_string()
    };
    let path = std::path::PathBuf::from(path);
    if !path.is_absolute() || !path.is_dir() {
        return Err("执行目录不存在或不是绝对路径".into());
    }
    Ok(path)
}
#[tauri::command]
pub fn terminal_start(
    state: State<'_, TerminalManager>,
    id: String,
    directory: String,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<(), String> {
    start_session(&state, id, directory, cols, rows, on_event)
}
fn start_session(
    manager: &TerminalManager,
    id: String,
    directory: String,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<(), String> {
    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    if sessions.contains_key(&id) {
        return Err("终端会话已存在".into());
    }
    if sessions.len() >= 32 {
        return Err("最多同时打开 32 个终端".into());
    }
    let cwd = working_directory(&directory)?;
    let pair = native_pty_system()
        .openpty(dimensions(cols, rows))
        .map_err(|e| e.to_string())?;
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| {
            unsafe {
                let user = libc::getpwuid(libc::getuid());
                if !user.is_null() && !(*user).pw_shell.is_null() {
                    let shell = std::ffi::CStr::from_ptr((*user).pw_shell)
                        .to_string_lossy()
                        .into_owned();
                    if !shell.is_empty() {
                        return shell;
                    }
                }
            }
            "/bin/zsh".into()
        });
    let mut command = CommandBuilder::new(shell);
    command.arg("-l");
    command.arg("-i");
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "Portside");
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);
    let poll_fd = pair.master.as_raw_fd();
    if let Some(fd) = poll_fd {
        unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFL);
            if flags >= 0 {
                libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
            }
        }
    }
    let (input, input_receiver) = mpsc::sync_channel::<(usize, Vec<u8>)>(32);
    let shell_pid = child.process_id().map(|pid| pid as i32);
    let session = Arc::new(PtySession {
        master: Mutex::new(Some(pair.master)),
        writer: Mutex::new(Some(writer)),
        child: Mutex::new(child),
        shell_pid,
        input,
        input_epoch: AtomicUsize::new(0),
        input_pending: AtomicUsize::new(0),
        exited: AtomicBool::new(false),
        flow: (
            Mutex::new(Flow {
                pending: 0,
                closed: false,
            }),
            Condvar::new(),
        ),
    });
    sessions.insert(id, session.clone());
    let input_session = session.clone();
    thread::spawn(move || {
        loop {
            if input_session.flow.0.lock().unwrap().closed
                || input_session.exited.load(Ordering::Acquire)
            {
                break;
            }
            let (epoch, bytes) =
                match input_receiver.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(bytes) => bytes,
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(_) => break,
                };
            let mut offset = 0;
            while offset < bytes.len() {
                if epoch != input_session.input_epoch.load(Ordering::Acquire)
                    || input_session.flow.0.lock().unwrap().closed
                    || input_session.exited.load(Ordering::Acquire)
                {
                    break;
                }
                let result = {
                    let mut writer = input_session.writer.lock().unwrap();
                    if epoch != input_session.input_epoch.load(Ordering::Acquire) {
                        break;
                    }
                    match writer.as_mut() {
                        Some(writer) => writer.write(&bytes[offset..]),
                        None => break,
                    }
                };
                match result {
                    Ok(0) => break,
                    Ok(count) => offset += count,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(std::time::Duration::from_millis(5))
                    }
                    Err(_) => break,
                }
            }
            input_session
                .input_pending
                .fetch_sub(bytes.len(), Ordering::AcqRel);
        }
        input_session.writer.lock().unwrap().take();
    });
    let reader_session = session.clone();
    let reader_channel = on_event.clone();
    thread::spawn(move || {
        let session = reader_session;
        let on_event = reader_channel;
        let mut bytes = [0u8; 8192];
        loop {
            if session.flow.0.lock().unwrap().closed {
                break;
            }
            if let Some(fd) = poll_fd {
                let mut descriptor = libc::pollfd {
                    fd,
                    events: libc::POLLIN,
                    revents: 0,
                };
                let ready = unsafe { libc::poll(&mut descriptor, 1, 100) };
                if ready <= 0 {
                    continue;
                }
                if descriptor.revents & libc::POLLNVAL != 0 {
                    break;
                }
            }
            if session.flow.0.lock().unwrap().closed {
                break;
            }
            let count = match reader.read(&mut bytes) {
                Ok(0) => break,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => continue,
                Err(_) => break,
                Ok(n) => n,
            };
            let (flow, wake) = &session.flow;
            let mut state = flow.lock().unwrap();
            while state.pending >= OUTPUT_WINDOW && !state.closed {
                state = wake.wait(state).unwrap();
            }
            if state.closed {
                break;
            }
            state.pending += count;
            drop(state);
            if on_event
                .send(TerminalEvent {
                    kind: "data".into(),
                    data: Some(bytes[..count].to_vec()),
                    code: None,
                })
                .is_err()
            {
                close(&session);
                break;
            }
        }
    });
    // Reap independently: a slave FD held by a job or a backpressured reader
    // must never delay collection of the shell's exit status.
    thread::spawn(move || {
        let code = loop {
            match session
                .child
                .lock()
                .ok()
                .and_then(|mut child| child.try_wait().ok())
            {
                Some(Some(status)) => break Some(status.exit_code()),
                Some(None) => thread::sleep(std::time::Duration::from_millis(30)),
                None => break None,
            }
        };
        session.exited.store(true, Ordering::Release);
        let _ = on_event.send(TerminalEvent {
            kind: "exit".into(),
            data: None,
            code,
        });
    });
    Ok(())
}
#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    enqueue_input(state.get(&id)?.as_ref(), data.into_bytes())
}
fn enqueue_input(session: &PtySession, data: Vec<u8>) -> Result<(), String> {
    if session.exited.load(Ordering::Acquire) || session.flow.0.lock().unwrap().closed {
        return Err("终端会话已关闭".into());
    }
    if data == [3] && session.input_pending.load(Ordering::Acquire) > 0 {
        let mut child = session.child.lock().map_err(|error| error.to_string())?;
        if !matches!(child.try_wait(), Ok(None)) {
            return Err("终端会话已关闭".into());
        }
        session.input_epoch.fetch_add(1, Ordering::AcqRel);
        let _writer = session.writer.lock().map_err(|error| error.to_string())?;
        let master = session.master.lock().map_err(|error| error.to_string())?;
        let master = master.as_ref().ok_or("终端会话已关闭")?;
        if let Some(group) = master.process_group_leader() {
            if Some(unsafe { libc::getsid(group) }) == session.shell_pid {
                if let Some(fd) = master.as_raw_fd() {
                    unsafe {
                        libc::tcflush(fd, libc::TCIOFLUSH);
                    }
                }
                if unsafe { libc::kill(-group, libc::SIGINT) } == 0 {
                    return Ok(());
                }
            }
        }
        return Err("无法中断当前终端任务".into());
    }
    let size = data.len();
    session
        .input_pending
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |pending| {
            pending
                .checked_add(size)
                .filter(|next| *next <= INPUT_WINDOW)
        })
        .map_err(|_| "终端输入队列已满（最多 256 KiB），请稍后再试".to_string())?;
    match session
        .input
        .try_send((session.input_epoch.load(Ordering::Acquire), data))
    {
        Ok(()) => Ok(()),
        Err(_) => {
            session.input_pending.fetch_sub(size, Ordering::AcqRel);
            Err("终端输入队列已满或会话已关闭".into())
        }
    }
}
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = state.get(&id)?;
    let result = session
        .master
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .ok_or("终端会话已关闭")?
        .resize(dimensions(cols, rows))
        .map_err(|e| e.to_string());
    result
}
#[tauri::command]
pub fn terminal_ack(
    state: State<'_, TerminalManager>,
    id: String,
    bytes: usize,
) -> Result<(), String> {
    let session = state.get(&id)?;
    let (flow, wake) = &session.flow;
    let mut state = flow.lock().map_err(|e| e.to_string())?;
    state.pending = state.pending.saturating_sub(bytes);
    wake.notify_all();
    Ok(())
}
// Query only when closing; never infer task state from terminal output or silence.
#[tauri::command]
pub fn terminal_has_tasks(state: State<'_, TerminalManager>, id: String) -> Result<bool, String> {
    let sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let Some(session) = sessions.get(&id).cloned() else {
        return Ok(false);
    };
    drop(sessions);
    has_tasks(&session)
}
fn has_tasks(session: &PtySession) -> Result<bool, String> {
    // Keep the live child unreaped while inspecting its session ID (PID reuse).
    let mut child = session.child.lock().map_err(|error| error.to_string())?;
    if child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Ok(false);
    }
    if session.input_pending.load(Ordering::Acquire) > 0 {
        return Ok(true);
    }
    let shell = session.shell_pid.ok_or("无法读取终端进程")?;
    let master = session.master.lock().map_err(|error| error.to_string())?;
    let group = master
        .as_ref()
        .and_then(|pty| pty.process_group_leader())
        .ok_or("无法读取终端前台任务")?;
    if group != shell {
        return Ok(true);
    }
    drop(master);
    #[cfg(target_os = "macos")]
    unsafe {
        let count = libc::proc_listallpids(std::ptr::null_mut(), 0);
        if count <= 0 {
            return Err("无法读取终端后台任务".into());
        }
        let mut pids = vec![0i32; count as usize + 256];
        let bytes = (pids.len() * std::mem::size_of::<i32>()) as i32;
        let count = libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes);
        if count <= 0 || count as usize >= pids.len() {
            return Err("无法读取终端后台任务".into());
        }
        for pid in pids.into_iter().take(count as usize) {
            if pid <= 1 || pid == shell || libc::getsid(pid) != shell {
                continue;
            }
            let mut info: libc::proc_bsdinfo = std::mem::zeroed();
            let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
            let read = libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            );
            // A disappearing process is harmless; unknown live processes remain conservative.
            if read == size && info.pbi_status == libc::SZOMB {
                continue;
            }
            if read != size && libc::getsid(pid) != shell {
                continue;
            }
            return Ok(true);
        }
        Ok(false)
    }
    #[cfg(not(target_os = "macos"))]
    Err("当前平台不支持检测终端后台任务".into())
}

#[tauri::command]
pub fn terminal_close(state: State<'_, TerminalManager>, id: String) -> Result<(), String> {
    if let Some(session) = state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
    {
        close(&session)
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::mpsc,
        time::{Duration, Instant},
    };
    struct Harness {
        manager: Arc<TerminalManager>,
        receiver: mpsc::Receiver<serde_json::Value>,
        id: String,
    }
    impl Harness {
        fn open(id: &str) -> Self {
            let manager = Arc::new(TerminalManager::default());
            let (tx, receiver) = mpsc::channel();
            let cloned = manager.clone();
            let id_owned = id.to_string();
            let channel = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                    let event: serde_json::Value = serde_json::from_str(&json).unwrap();
                    if let Some(data) = event["data"].as_array() {
                        if let Ok(session) = cloned.get(&id_owned) {
                            let (flow, wake) = &session.flow;
                            let mut s = flow.lock().unwrap();
                            s.pending = s.pending.saturating_sub(data.len());
                            wake.notify_all();
                        }
                    }
                    let _ = tx.send(event);
                }
                Ok(())
            });
            start_session(&manager, id.into(), "~".into(), 80, 24, channel).unwrap();
            let harness = Self {
                manager,
                receiver,
                id: id.into(),
            };
            harness.input("printf '\\122\\125\\116TIME_READY\\n'\r");
            harness.until("RUNTIME_READY");
            harness
        }
        fn input(&self, input: &str) {
            let session = self.manager.get(&self.id).unwrap();
            let mut writer = session.writer.lock().unwrap();
            let writer = writer.as_mut().unwrap();
            writer.write_all(input.as_bytes()).unwrap();
            writer.flush().unwrap();
        }
        fn until(&self, needle: &str) -> String {
            let end = Instant::now() + Duration::from_secs(30);
            let mut output = String::new();
            while Instant::now() < end {
                let event = match self.receiver.recv_timeout(Duration::from_secs(1)) {
                    Ok(event) => event,
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(error) => panic!("PTY channel: {error}; output: {output}"),
                };
                if let Some(data) = event["data"].as_array() {
                    let bytes: Vec<_> = data.iter().map(|n| n.as_u64().unwrap() as u8).collect();
                    output.push_str(&String::from_utf8_lossy(&bytes));
                }
                if output.contains(needle) {
                    return output;
                }
            }
            panic!("missing {needle}: {output}")
        }
    }
    impl Drop for Harness {
        fn drop(&mut self) {
            self.manager.close_all()
        }
    }
    #[test]
    fn real_interaction_resize_interrupt_and_exit() {
        let terminal = Harness::open("test-interactive");
        terminal.input("printf '\\120\\124\\131_READY\\n'\r");
        terminal.until("PTY_READY");
        let session = terminal.manager.get(&terminal.id).unwrap();
        session
            .master
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .resize(dimensions(101, 31))
            .unwrap();
        terminal.input("stty size\r");
        assert!(terminal.until("31 101").contains("31 101"));
        terminal.input("sleep 60\r");
        thread::sleep(Duration::from_millis(250));
        terminal.input("\x03");
        terminal.input("printf '\\111\\116\\124ERRUPTED\\n'\r");
        terminal.until("INTERRUPTED");
        terminal.input("printf '\\344\\270\\255\\346\\226\\207\\n'\r");
        terminal.until("中文");
        terminal.input("exit 7\r");
        let end = Instant::now() + Duration::from_secs(30);
        loop {
            match terminal.receiver.recv_timeout(Duration::from_secs(1)) {
                Ok(event) if event["kind"] == "exit" => {
                    assert_eq!(event["code"], 7);
                    break;
                }
                Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {
                    assert!(Instant::now() < end, "shell exit timed out")
                }
                Err(error) => panic!("exit channel: {error}"),
            }
        }
    }
    #[test]
    fn concurrent_sessions_and_close_own_group() {
        let first = Harness::open("first");
        let second = Harness::open("second");
        first.input("printf '\\106IRST\\n'\r");
        second.input("printf '\\123ECOND\\n'\r");
        first.until("FIRST");
        second.until("SECOND");
        let session = first.manager.get("first").unwrap();
        let pid = session.child.lock().unwrap().process_id().unwrap();
        first.manager.close_all();
        let end = Instant::now() + Duration::from_secs(3);
        while Instant::now() < end {
            if unsafe { libc::kill(pid as i32, 0) } < 0 {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            unsafe { libc::kill(pid as i32, 0) } < 0,
            "owned shell remained alive"
        );
        second.input("printf '\\123TILL_ALIVE\\n'\r");
        second.until("STILL_ALIVE");
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn detects_idle_foreground_background_and_exited_tasks() {
        let terminal = Harness::open("task-detection");
        let session = terminal.manager.get(&terminal.id).unwrap();
        let wait = |expected| {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if has_tasks(&session) == Ok(expected) {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "task state did not become {expected}"
                );
                thread::sleep(Duration::from_millis(20));
            }
        };
        wait(false);
        terminal.input("sleep 60\r");
        wait(true);
        terminal.input("\x03");
        wait(false);
        terminal.input("sleep 60 & printf '\\102G_READY\\n'\r");
        terminal.until("BG_READY");
        wait(true);
        // A background job must count even when the shell owns the foreground group.
        let shell = session.shell_pid.unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let group = session
                .master
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .process_group_leader();
            if group == Some(shell) {
                break;
            }
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(20));
        }
        assert!(has_tasks(&session).unwrap());
        terminal.input("kill $(jobs -p); wait; printf '\\102G_DONE\\n'\r");
        terminal.until("BG_DONE");
        wait(false);
        terminal.input("exit\r");
        let deadline = Instant::now() + Duration::from_secs(5);
        while !session.exited.load(Ordering::Acquire) {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!has_tasks(&session).unwrap());
    }
    #[test]
    fn closing_cleans_foreground_and_background_jobs() {
        let terminal = Harness::open("job-cleanup");
        let pidfile =
            std::env::temp_dir().join(format!("portside-pty-jobs-{}", std::process::id()));
        terminal.input(&format!(
            "sleep 60 & echo $! > '{}'; sleep 60\r",
            pidfile.display()
        ));
        let end = Instant::now() + Duration::from_secs(5);
        let background: i32 = loop {
            if let Ok(text) = std::fs::read_to_string(&pidfile) {
                if let Ok(pid) = text.trim().parse() {
                    break pid;
                }
            }
            assert!(Instant::now() < end, "background PID file incomplete");
            thread::sleep(Duration::from_millis(20));
        };
        let session = terminal.manager.get(&terminal.id).unwrap();
        let shell = session.shell_pid.unwrap();
        let foreground = loop {
            let foreground = session
                .master
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .process_group_leader()
                .unwrap();
            if foreground != shell {
                break foreground;
            }
            assert!(Instant::now() < end);
            thread::sleep(Duration::from_millis(20));
        };
        assert_eq!(unsafe { libc::getsid(background) }, shell);
        assert_eq!(unsafe { libc::getsid(foreground) }, shell);
        let started = Instant::now();
        terminal.manager.close_all();
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "close blocked on wait lock"
        );
        for pid in [shell, foreground, background] {
            let end = Instant::now() + Duration::from_secs(5);
            loop {
                if unsafe { libc::kill(pid, 0) } < 0 {
                    break;
                }
                if Instant::now() >= end {
                    let diagnostic = std::process::Command::new("/bin/ps")
                        .args([
                            "-o",
                            "pid,ppid,pgid,sess,state,command",
                            "-p",
                            &pid.to_string(),
                        ])
                        .output()
                        .unwrap();
                    panic!("owned job {pid} remained alive (shell {shell}, fg {foreground}, bg {background}): {}",String::from_utf8_lossy(&diagnostic.stdout));
                }
                thread::sleep(Duration::from_millis(20));
            }
        }
        let _ = std::fs::remove_file(pidfile);
    }
    #[test]
    fn shell_exit_is_reaped_while_background_job_holds_pty() {
        let terminal = Harness::open("independent-reaper");
        let pidfile =
            std::env::temp_dir().join(format!("portside-pty-reaper-{}", std::process::id()));
        terminal.input(&format!(
            "sleep 60 & echo $! > '{}'; disown; exit 9\r",
            pidfile.display()
        ));
        let end = Instant::now() + Duration::from_secs(10);
        loop {
            match terminal.receiver.recv_timeout(Duration::from_millis(200)) {
                Ok(event) if event["kind"] == "exit" => {
                    assert_eq!(event["code"], 9);
                    break;
                }
                Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {
                    assert!(Instant::now() < end, "exit was blocked by PTY reader")
                }
                Err(error) => panic!("reaper event: {error}"),
            }
        }
        let shell = terminal
            .manager
            .get(&terminal.id)
            .unwrap()
            .shell_pid
            .unwrap();
        assert!(
            unsafe { libc::kill(shell, 0) } < 0,
            "exited shell not reaped"
        );
        terminal.manager.close_all();
        let background: i32 = std::fs::read_to_string(&pidfile)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        if unsafe { libc::getsid(background) } == shell {
            unsafe {
                libc::kill(background, libc::SIGKILL);
            }
        }
        let _ = std::fs::remove_file(pidfile);
    }
    #[test]
    fn closing_exited_session_never_signals_reused_pid() {
        let mut unrelated = std::process::Command::new("/bin/sleep")
            .arg("60")
            .spawn()
            .unwrap();
        let mut exited = std::process::Command::new("/usr/bin/true").spawn().unwrap();
        exited.wait().unwrap();
        let pair = native_pty_system().openpty(dimensions(80, 24)).unwrap();
        let writer = pair.master.take_writer().unwrap();
        let session = PtySession {
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(writer)),
            child: Mutex::new(Box::new(exited)),
            shell_pid: Some(unrelated.id() as i32),
            input: mpsc::sync_channel(1).0,
            input_epoch: AtomicUsize::new(0),
            input_pending: AtomicUsize::new(0),
            exited: AtomicBool::new(false),
            flow: (
                Mutex::new(Flow {
                    pending: 0,
                    closed: false,
                }),
                Condvar::new(),
            ),
        };
        close(&session);
        assert!(
            unrelated.try_wait().unwrap().is_none(),
            "exited session signalled a recycled PID"
        );
        unrelated.kill().unwrap();
        unrelated.wait().unwrap();
    }
    #[test]
    fn blocked_large_input_is_bounded_and_close_remains_responsive() {
        let terminal = Harness::open("input-backpressure");
        terminal.input("stty -icanon -echo; printf '\\111NPUT_READY\\n'; sleep 60\r");
        terminal.until("INPUT_READY");
        let session = terminal.manager.get(&terminal.id).unwrap();
        let shell = session.shell_pid.unwrap();
        enqueue_input(&session, vec![b'x'; INPUT_WINDOW]).unwrap();
        assert!(
            enqueue_input(&session, vec![b'y'; INPUT_WINDOW + 1]).is_err(),
            "accepted unbounded input"
        );
        thread::sleep(Duration::from_millis(100));
        assert!(session.input_pending.load(Ordering::Acquire) <= INPUT_WINDOW);
        enqueue_input(&session, vec![3]).expect("Ctrl+C must bypass a saturated input queue");
        let end = Instant::now() + Duration::from_secs(3);
        while session.input_pending.load(Ordering::Acquire) > 0 {
            assert!(Instant::now() < end, "interrupted paste was not cancelled");
            thread::sleep(Duration::from_millis(10));
        }
        terminal.input("printf '\\101FTER_INTERRUPT\\n'\r");
        terminal.until("AFTER_INTERRUPT");
        terminal.input("stty -icanon -echo; sleep 60\r");
        thread::sleep(Duration::from_millis(100));
        enqueue_input(&session, vec![b'x'; INPUT_WINDOW]).unwrap();
        let start = Instant::now();
        terminal.manager.close_all();
        assert!(
            start.elapsed() < Duration::from_secs(1),
            "close waited on blocked input writer"
        );
        let end = Instant::now() + Duration::from_secs(3);
        while unsafe { libc::kill(shell, 0) } == 0 {
            assert!(Instant::now() < end, "blocked input shell was not reaped");
            thread::sleep(Duration::from_millis(20));
        }
    }
    #[test]
    fn output_is_backpressured_without_renderer_ack() {
        let manager = TerminalManager::default();
        let channel = Channel::new(|_| Ok(()));
        start_session(&manager, "bounded".into(), "~".into(), 80, 24, channel).unwrap();
        let session = manager.get("bounded").unwrap();
        {
            let mut writer = session.writer.lock().unwrap();
            let writer = writer.as_mut().unwrap();
            writer.write_all(b"/usr/bin/yes PORTSIDE_FLOW\r").unwrap();
            writer.flush().unwrap();
        }
        let end = Instant::now() + Duration::from_secs(30);
        loop {
            let pending = session.flow.0.lock().unwrap().pending;
            if pending >= OUTPUT_WINDOW {
                assert!(pending <= OUTPUT_WINDOW + 8192);
                break;
            }
            assert!(Instant::now() < end, "output did not reach flow limit");
            thread::sleep(Duration::from_millis(20));
        }
        let pending = session.flow.0.lock().unwrap().pending;
        thread::sleep(Duration::from_millis(100));
        assert_eq!(session.flow.0.lock().unwrap().pending, pending);
        manager.close_all();
    }
    #[test]
    fn invalid_directory_and_dimensions() {
        assert!(working_directory("/missing-portside-test-folder").is_err());
        assert!(working_directory("relative").is_err());
        assert_eq!(dimensions(0, 0).rows, 2);
        assert_eq!(dimensions(u16::MAX, 2).cols, 1000);
    }
}
