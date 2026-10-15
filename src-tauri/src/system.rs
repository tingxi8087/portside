//! macOS process sampler. No shell interpolation and no privileged escalation.
use serde::Serialize;
use std::{
    collections::HashMap,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub parent: u32,
    pub name: String,
    pub app: String,
    pub user: String,
    pub mine: bool,
    pub command: String,
    pub executable: String,
    pub started: String,
    pub identity: String,
    pub color: String,
    pub cpu: Option<f64>,
    pub memory: Option<f64>,
    pub disk: Option<f64>,
    pub network: Option<f64>,
    pub network_in: Option<f64>,
    pub network_out: Option<f64>,
    pub metrics_note: String,
}
#[derive(Clone, Serialize, Debug)]
pub struct PortInfo {
    pub id: String,
    pub port: u16,
    pub pid: u32,
    pub protocol: String,
    pub address: String,
    pub scope: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub processes: Vec<ProcessInfo>,
    pub ports: Vec<PortInfo>,
    pub current_user: String,
    pub warnings: Vec<String>,
}
#[derive(Default)]
pub struct SystemMonitor {
    inner: Arc<Mutex<Sampler>>,
}
#[derive(Default)]
struct Sampler {
    previous: HashMap<String, Counters>,
    cached: Option<(Instant, Snapshot)>,
}
struct Counters {
    at: Instant,
    cpu: u64,
    disk: u64,
    network: Option<(u64, u64)>,
}

#[repr(C)]
#[derive(Default)]
struct Usage {
    uuid: [u8; 16],
    user: u64,
    system: u64,
    idle: u64,
    interrupt: u64,
    pageins: u64,
    wired: u64,
    resident: u64,
    footprint: u64,
    start: u64,
    exit: u64,
    child_user: u64,
    child_system: u64,
    child_idle: u64,
    child_interrupt: u64,
    child_pageins: u64,
    child_elapsed: u64,
    read: u64,
    written: u64,
}
#[link(name = "proc")]
extern "C" {
    fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut Usage) -> i32;
    fn proc_pidpath(pid: i32, buffer: *mut u8, size: u32) -> i32;
}
extern "C" {
    fn geteuid() -> u32;
    fn kill(pid: i32, signal: i32) -> i32;
}
fn usage(pid: u32) -> Option<Usage> {
    let mut value = Usage::default();
    if unsafe { proc_pid_rusage(pid as i32, 2, &mut value) } == 0 {
        Some(value)
    } else {
        None
    }
}
fn executable(pid: u32) -> String {
    let mut b = [0u8; 4096];
    let n = unsafe { proc_pidpath(pid as i32, b.as_mut_ptr(), b.len() as u32) };
    if n > 0 {
        String::from_utf8_lossy(&b[..n as usize])
            .trim_end_matches('\0')
            .to_owned()
    } else {
        String::new()
    }
}
// Bound external tools so a stuck sampler cannot hold IPC indefinitely.
fn output(path: &str, args: &[&str]) -> Result<(String, String, i32), String> {
    let mut child = Command::new(path)
        .args(args)
        .env("LC_ALL", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{path}: {e}"))?;
    let out = child.stdout.take().unwrap();
    let err = child.stderr.take().unwrap();
    let reader = thread::spawn(move || {
        use std::io::Read;
        let mut text = String::new();
        let _ = std::io::BufReader::new(out).read_to_string(&mut text);
        text
    });
    let errors = thread::spawn(move || {
        use std::io::Read;
        let mut text = String::new();
        let _ = std::io::BufReader::new(err).read_to_string(&mut text);
        text
    });
    let begin = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if begin.elapsed() < Duration::from_secs(8) => {
                thread::sleep(Duration::from_millis(10))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{path} 采集超时或退出异常"));
            }
        }
    };
    Ok((
        reader.join().unwrap_or_default(),
        errors.join().unwrap_or_default(),
        status.code().unwrap_or(-1),
    ))
}
fn process_rows(pid: Option<u32>) -> Result<Vec<(ProcessInfo, Option<Usage>)>, String> {
    let selected = pid.map(|p| p.to_string());
    let args = if let Some(ref id) = selected {
        vec![
            "-p",
            id,
            "-o",
            "pid=,ppid=,uid=,user=,pcpu=,rss=,lstart=,args=",
        ]
    } else {
        vec![
            "-ax",
            "-o",
            "pid=,ppid=,uid=,user=,pcpu=,rss=,lstart=,args=",
        ]
    };
    let (text, err, status) = output("/bin/ps", &args)?;
    if status != 0 {
        if pid.is_some() {
            return Ok(vec![]);
        }
        return Err(format!("进程采集失败：{err}"));
    }
    Ok(text
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 12 {
                return None;
            }
            let pid = fields[0].parse().ok()?;
            let u = usage(pid);
            let path = executable(pid);
            let command = fields[11..].join(" ");
            let name = std::path::Path::new(if path.is_empty() { fields[11] } else { &path })
                .file_name()?
                .to_string_lossy()
                .into_owned();
            let started = fields[6..11].join(" ");
            let identity = format!(
                "{pid}:{started}:{}:{path}",
                u.as_ref().map(|u| u.start).unwrap_or(0)
            );
            let info = ProcessInfo {
                pid,
                parent: fields[1].parse().unwrap_or(0),
                mine: fields[2].parse::<u32>().ok() == Some(unsafe { geteuid() }),
                user: fields[3].into(),
                app: if path.starts_with("/System/") || path.starts_with("/usr/") {
                    "macOS".into()
                } else {
                    path.clone()
                },
                command,
                executable: path,
                started,
                identity,
                name,
                color: "gray".into(),
                cpu: None,
                memory: fields[5].parse::<f64>().ok().map(|rss| rss / 1024.),
                disk: None,
                network: None,
                network_in: None,
                network_out: None,
                metrics_note: String::new(),
            };
            Some((info, u))
        })
        .collect())
}
fn parse_ports(text: &str) -> Vec<PortInfo> {
    let mut pid = 0;
    let mut protocol = "";
    let mut ports = vec![];
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let (kind, value) = line.split_at(1);
        match kind {
            "p" => pid = value.parse().unwrap_or(0),
            "P" => protocol = value,
            "n" => {
                let local = value.split("->").next().unwrap_or(value);
                if let Some((address, port)) = local.rsplit_once(':') {
                    if let Ok(port) = port.parse::<u16>() {
                        let address = address.trim_matches(['[', ']']);
                        ports.push(PortInfo {
                            id: format!("{pid}:{protocol}:{address}:{port}"),
                            pid,
                            port,
                            protocol: protocol.into(),
                            address: address.into(),
                            scope: if address == "::1" || address.starts_with("127.") {
                                "local"
                            } else {
                                "network"
                            }
                            .into(),
                        });
                    }
                }
            }
            _ => {}
        }
    }
    ports.sort_by(|a, b| a.id.cmp(&b.id));
    ports.dedup_by(|a, b| a.id == b.id);
    ports
}
fn parse_network(text: &str) -> HashMap<u32, (u64, u64)> {
    text.lines()
        .filter_map(|line| {
            let mut f = line.split(',');
            let pid = f.next()?.rsplit_once('.')?.1.parse().ok()?;
            Some((pid, (f.next()?.parse().ok()?, f.next()?.parse().ok()?)))
        })
        .collect()
}
impl Sampler {
    fn sample(&mut self) -> Result<Snapshot, String> {
        if let Some((at, ref value)) = self.cached {
            if at.elapsed() < Duration::from_millis(600) {
                return Ok(value.clone());
            }
        }
        let mut warnings = vec![];
        let port_thread = thread::spawn(|| {
            output(
                "/usr/sbin/lsof",
                &["-nP", "-iTCP", "-sTCP:LISTEN", "-iUDP", "-F", "pPn"],
            )
        });
        let network_thread = thread::spawn(|| {
            output(
                "/usr/bin/nettop",
                &["-P", "-L", "1", "-n", "-x", "-J", "bytes_in,bytes_out"],
            )
        });
        let rows = process_rows(None)?;
        let ports = match port_thread.join() {
            Ok(Ok((text, err, status))) => {
                if status != 0 && status != 1 {
                    warnings.push(format!("端口采集失败：{err}"))
                }
                parse_ports(&text)
            }
            _ => {
                warnings.push("端口采集失败".into());
                vec![]
            }
        };
        let network = match network_thread.join() {
            Ok(Ok((text, _, 0))) => parse_network(&text),
            _ => {
                warnings.push("网络采集不可用：nettop 未能读取流量".into());
                HashMap::new()
            }
        };
        warnings.push("系统权限可能限制其他用户的端口、命令行和资源数据；— 表示首采样或不可用。CPU 单核满载为 100%，内存为 RSS MiB，磁盘和网络为采样间隔内 KiB/s。".into());
        let now = Instant::now();
        let mut next = HashMap::new();
        let mut processes = vec![];
        for (mut p, u) in rows {
            let net = network.get(&p.pid).copied();
            if let Some(u) = u {
                let cpu = u.user.saturating_add(u.system);
                let disk = u.read.saturating_add(u.written);
                if let Some(old) = self.previous.get(&p.identity) {
                    let seconds = now.duration_since(old.at).as_secs_f64();
                    if seconds > 0.1 {
                        p.cpu = Some(cpu.saturating_sub(old.cpu) as f64 / 1e9 / seconds * 100.);
                        p.disk = Some(disk.saturating_sub(old.disk) as f64 / 1024. / seconds);
                        if let (Some((rx, tx)), Some((rx0, tx0))) = (net, old.network) {
                            if rx >= rx0 && tx >= tx0 {
                                p.network_in = Some((rx - rx0) as f64 / 1024. / seconds);
                                p.network_out = Some((tx - tx0) as f64 / 1024. / seconds);
                                p.network = Some(p.network_in.unwrap() + p.network_out.unwrap())
                            }
                        }
                    }
                }
                next.insert(
                    p.identity.clone(),
                    Counters {
                        at: now,
                        cpu,
                        disk,
                        network: net,
                    },
                );
            } else {
                p.metrics_note = "系统未授权读取此进程的 CPU / 磁盘计数".into()
            }
            if p.network.is_none() {
                if !p.metrics_note.is_empty() {
                    p.metrics_note.push_str("；")
                }
                p.metrics_note
                    .push_str("网络暂不可用（首次采样、进程无可观察套接字或权限受限）")
            }
            processes.push(p);
        }
        self.previous = next;
        let snapshot = Snapshot {
            current_user: std::env::var("USER").unwrap_or_default(),
            processes,
            ports,
            warnings,
        };
        self.cached = Some((now, snapshot.clone()));
        Ok(snapshot)
    }
}
#[tauri::command]
pub async fn system_snapshot(state: tauri::State<'_, SystemMonitor>) -> Result<Snapshot, String> {
    let inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || inner.lock().map_err(|_| "采集状态异常")?.sample())
        .await
        .map_err(|e| e.to_string())?
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Termination {
    pub exited: bool,
    pub signal: String,
}
fn terminate(pid: u32, identity: &str, force: bool) -> Result<Termination, String> {
    if pid <= 1 || pid == std::process::id() || pid > i32::MAX as u32 {
        return Err("不能结束系统核心进程或 Portside 自身".into());
    }
    let rows = process_rows(Some(pid))?;
    let Some((current, _)) = rows.first() else {
        return Ok(Termination {
            exited: true,
            signal: "none".into(),
        });
    };
    if current.identity != identity {
        return Err("进程身份已变化，已取消操作。请刷新后重试。".into());
    }
    let signal = if force { 9 } else { 15 };
    if unsafe { kill(pid as i32, signal) } != 0 {
        return Err(format!("发送信号失败：{}", std::io::Error::last_os_error()));
    }
    for _ in 0..12 {
        thread::sleep(Duration::from_millis(100));
        let rows = process_rows(Some(pid))?;
        if rows.is_empty() || rows.first().map(|(p, _)| p.identity.as_str()) != Some(identity) {
            return Ok(Termination {
                exited: true,
                signal: if force { "KILL" } else { "TERM" }.into(),
            });
        }
    }
    Ok(Termination {
        exited: false,
        signal: if force { "KILL" } else { "TERM" }.into(),
    })
}
#[tauri::command]
pub async fn terminate_process(
    pid: u32,
    identity: String,
    force: bool,
) -> Result<Termination, String> {
    tauri::async_runtime::spawn_blocking(move || terminate(pid, &identity, force))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_ipv6_udp_and_deduplicates() {
        let p = parse_ports("p42\nPTCP\nn[::1]:1234\nn[::1]:1234\nPUDP\nn*:5353\nn*:*\n");
        assert_eq!(p.len(), 2);
        assert_eq!(p.iter().find(|p| p.port == 1234).unwrap().scope, "local");
    }
    #[test]
    fn parses_network_process_names_with_dots() {
        assert_eq!(
            parse_network("Google.Chrome.42,123,456,\n").get(&42),
            Some(&(123, 456))
        );
    }
    #[test]
    fn protects_core_and_self() {
        assert!(terminate(1, "", false).is_err());
        assert!(terminate(std::process::id(), "", false).is_err());
    }
    #[test]
    fn live_listener_identity_and_termination() {
        let mut child=Command::new("/usr/bin/python3").args(["-u","-c","import socket,time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); print(s.getsockname()[1],flush=True); time.sleep(120)"]).stdout(Stdio::piped()).spawn().unwrap();
        use std::io::BufRead;
        let mut line = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let port: u16 = line.trim().parse().unwrap();
        let pid = child.id();
        let p = process_rows(Some(pid)).unwrap().remove(0).0;
        assert!(terminate(pid, "wrong-identity", false).is_err());
        assert!(child.try_wait().unwrap().is_none());
        let mut monitor = Sampler::default();
        let first = monitor.sample().unwrap();
        assert!(first.ports.iter().any(|p| p.pid == pid && p.port == port));
        thread::sleep(Duration::from_millis(700));
        let second = monitor.sample().unwrap();
        let sample = second.processes.iter().find(|p| p.pid == pid).unwrap();
        assert!(sample.memory.unwrap() > 0.);
        assert!(sample.cpu.is_some());
        assert!(sample.disk.is_some());
        let result = terminate(pid, &p.identity, false).unwrap();
        let _ = child.wait();
        assert!(result.exited);
        let ports = output(
            "/usr/sbin/lsof",
            &["-nP", "-iTCP", "-sTCP:LISTEN", "-iUDP", "-F", "pPn"],
        )
        .unwrap()
        .0;
        assert!(!parse_ports(&ports)
            .iter()
            .any(|p| p.pid == pid && p.port == port));
    }
    #[test]
    fn force_termination_requires_identity_and_real_signal() {
        let mut child=Command::new("/usr/bin/python3").args(["-u","-c","import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);print('ready',flush=True);time.sleep(30)"]).stdout(Stdio::piped()).spawn().unwrap();
        use std::io::BufRead;
        let mut ready = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut ready)
            .unwrap();
        let p = process_rows(Some(child.id())).unwrap().remove(0).0;
        let result = terminate(child.id(), &p.identity, false).unwrap();
        assert!(!result.exited);
        assert!(child.try_wait().unwrap().is_none());
        let result = terminate(child.id(), &p.identity, true).unwrap();
        let _ = child.wait();
        assert!(result.exited);
    }
    #[test]
    fn live_network_and_busy_cpu_are_measured() {
        let script = r#"import socket,threading,time,os,tempfile
s=socket.socket();s.bind(('127.0.0.1',0));s.listen()
def reader():
 c,_=s.accept()
 while c.recv(65536): pass
threading.Thread(target=reader,daemon=True).start()
c=socket.create_connection(s.getsockname())
print('ready',flush=True)
end=time.time()+15
with tempfile.TemporaryFile() as f:
 while time.time()<end:
  c.sendall(b'x'*65536)
  f.seek(0);f.write(b'x'*65536);f.flush();os.fsync(f.fileno())
"#;
        let mut child = Command::new("/usr/bin/python3")
            .args(["-u", "-c", script])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        use std::io::BufRead;
        let mut ready = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut ready)
            .unwrap();
        let pid = child.id();
        let mut sampler = Sampler::default();
        sampler.sample().unwrap();
        thread::sleep(Duration::from_millis(900));
        let sample = sampler.sample().unwrap();
        let p = sample.processes.iter().find(|p| p.pid == pid).unwrap();
        let measurements = (p.cpu, p.disk, p.network_in, p.network_out);
        let _ = child.kill();
        let _ = child.wait();
        println!("busy child metrics CPU/disk/rx/tx: {:?}", measurements);
        assert!(measurements.0.unwrap() > 0.);
        assert!(measurements.1.is_some());
        assert!(measurements.2.unwrap() > 0.);
        assert!(measurements.3.unwrap() > 0.);
    }
}
