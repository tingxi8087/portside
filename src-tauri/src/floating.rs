use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Instant,
};
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
const METRICS: [(&str, &str); 5] = [
    ("cpu", "整机 CPU 使用率"),
    ("memory", "内存使用率"),
    ("download", "下载速度"),
    ("upload", "上传速度"),
    ("ports", "监听端口数"),
];
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    pub metrics: Vec<String>,
    pub theme: String,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            metrics: vec!["cpu".into()],
            theme: "system".into(),
        }
    }
}
impl Config {
    fn validate(&self) -> Result<(), String> {
        if self.metrics.is_empty()
            || self.metrics.len() > 3
            || self.metrics.iter().enumerate().any(|(i, id)| {
                !METRICS.iter().any(|(key, _)| key == id) || self.metrics[..i].contains(id)
            })
        {
            return Err("请选择 1 至 3 个不同的指标".into());
        }
        if !["light", "dark", "system"].contains(&self.theme.as_str()) {
            return Err("无效主题".into());
        }
        Ok(())
    }
}
#[derive(Default)]
pub struct FloatingState {
    operation: tauri::async_runtime::Mutex<()>,
    menu: Mutex<Option<tauri::menu::Menu<tauri::Wry>>>,
    config: Mutex<Config>,
    revision: AtomicU64,
    configured: std::sync::atomic::AtomicBool,
}
pub struct Meter {
    system: sysinfo::System,
    networks: sysinfo::Networks,
    previous: Option<Instant>,
    cached: Option<(Instant, Stats)>,
}
impl Default for Meter {
    fn default() -> Self {
        Self {
            system: sysinfo::System::new(),
            networks: sysinfo::Networks::new(),
            previous: None,
            cached: None,
        }
    }
}
#[derive(Default)]
pub struct FloatingMeter(Mutex<Meter>);
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    cpu: Option<f64>,
    memory: Option<f64>,
    memory_used: u64,
    memory_total: u64,
    download: Option<f64>,
    upload: Option<f64>,
    ports: Option<usize>,
}
fn position_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("floating-position.json"))
}
fn dimensions(count: usize) -> (f64, f64) {
    (
        if count == 1 {
            64.0
        } else {
            (count * 66 + 30) as f64
        },
        64.0,
    )
}
fn clamp_position(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    area: tauri::PhysicalRect<i32, u32>,
    gap: i32,
    snap: bool,
) -> (i32, i32) {
    let left = area.position.x + gap;
    let top = area.position.y + gap;
    let right = (area.position.x + area.size.width as i32 - w as i32 - gap).max(left);
    let bottom = (area.position.y + area.size.height as i32 - h as i32 - gap).max(top);
    let nx = if snap {
        if (x - left).abs() < (x - right).abs() {
            left
        } else {
            right
        }
    } else {
        x.clamp(left, right)
    };
    (nx, y.clamp(top, bottom))
}
fn place(window: &WebviewWindow, snap: bool) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| {
            let a = m.work_area();
            let cx = position.x + size.width as i32 / 2;
            let cy = position.y + size.height as i32 / 2;
            cx >= a.position.x
                && cy >= a.position.y
                && cx < a.position.x + a.size.width as i32
                && cy < a.position.y + a.size.height as i32
        })
        .cloned()
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("未找到显示器")?;
    let gap = (6.0 * monitor.scale_factor()) as i32;
    let (x, y) = clamp_position(
        position.x,
        position.y,
        size.width,
        size.height,
        *monitor.work_area(),
        gap,
        snap,
    );
    if position.x != x || position.y != y {
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn floating_configure(
    app: tauri::AppHandle,
    state: tauri::State<'_, FloatingState>,
    config: Config,
) -> Result<(), String> {
    let _operation = state.operation.lock().await;
    config.validate()?;
    let first = !state.configured.swap(true, Ordering::AcqRel);
    *state.config.lock().map_err(|e| e.to_string())? = config.clone();
    if !config.enabled {
        if let Some(window) = app.get_webview_window("floating") {
            let _ = window.emit("floating-config", &config);
            window.hide().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let main_focused = app
        .get_webview_window("main")
        .is_some_and(|main| main.is_focused().unwrap_or(false));
    let (width, height) = dimensions(config.metrics.len());
    let window = if let Some(window) = app.get_webview_window("floating") {
        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        window
    } else {
        let window = WebviewWindowBuilder::new(
            &app,
            "floating",
            WebviewUrl::App("index.html?floating=1".into()),
        )
        .title("Portside 悬浮球")
        .inner_size(width, height)
        .decorations(false)
        .resizable(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .accept_first_mouse(true)
        .visible_on_all_workspaces(true)
        .build()
        .map_err(|e| e.to_string())?;
        if let Ok(file) = position_file(&app) {
            if let Ok(bytes) = std::fs::read(file) {
                if let Ok([x, y]) = serde_json::from_slice::<[i32; 2]>(&bytes) {
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                }
            } else if let Ok(Some(m)) = window.primary_monitor() {
                let area = m.work_area();
                let _ = window.set_position(PhysicalPosition::new(
                    area.position.x + area.size.width as i32 - 200,
                    area.position.y + area.size.height as i32 / 2,
                ));
            }
        }
        window
    };
    place(&window, false)?;
    window
        .emit("floating-config", &config)
        .map_err(|e| e.to_string())?;
    if !window.is_visible().map_err(|e| e.to_string())? {
        window.show().map_err(|e| e.to_string())?;
        if main_focused {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }
        }
    }
    if first && std::env::args().any(|arg| arg == "--autostart") {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.hide();
        }
    }
    Ok(())
}
#[tauri::command]
pub fn floating_state(state: tauri::State<'_, FloatingState>) -> Config {
    state.config.lock().unwrap().clone()
}
#[tauri::command]
pub async fn floating_sample(app: tauri::AppHandle) -> Result<Stats, String> {
    // Repair positions after a display is disconnected, without moving a ball being dragged.
    if let Some(window) = app.get_webview_window("floating") {
        let _ = place(&window, false);
    }
    tauri::async_runtime::spawn_blocking(move || sample_shared(&app))
        .await
        .map_err(|e| e.to_string())?
}

// One meter/cache for both windows. A second consumer must not reset CPU/network deltas.
pub(crate) fn sample_shared(app: &tauri::AppHandle) -> Result<Stats, String> {
    let ports = app
        .state::<FloatingState>()
        .config
        .lock()
        .map_err(|e| e.to_string())?
        .metrics
        .iter()
        .any(|m| m == "ports");
    let state = app.state::<FloatingMeter>();
    let mut m = state.0.lock().map_err(|e| e.to_string())?;
    let stats = sample_meter(&mut m, ports);
    drop(m);
    let _ = app.emit_to("floating", "system-stats", &stats);
    Ok(stats)
}
fn sample_meter(m: &mut Meter, ports: bool) -> Stats {
    if let Some((at, stats)) = &mut m.cached {
        if at.elapsed().as_secs_f64() < 1.0 {
            if ports && stats.ports.is_none() {
                stats.ports = crate::system::listener_count().ok();
            }
            return stats.clone();
        }
    }
    m.system.refresh_cpu_usage();
    m.system.refresh_memory();
    m.networks.refresh(true);
    let elapsed = m.previous.map(|at| at.elapsed().as_secs_f64());
    let now = Instant::now();
    m.previous = Some(now);
    let total = m.system.total_memory();
    let used = m.system.used_memory();
    let rx: u64 = m
        .networks
        .iter()
        .filter(|(name, _)| !name.starts_with("lo"))
        .map(|(_, n)| n.received())
        .sum();
    let tx: u64 = m
        .networks
        .iter()
        .filter(|(name, _)| !name.starts_with("lo"))
        .map(|(_, n)| n.transmitted())
        .sum();
    let stats = Stats {
        cpu: elapsed
            .filter(|s| *s >= 0.2)
            .map(|_| m.system.global_cpu_usage() as f64),
        memory: (total > 0).then(|| used as f64 / total as f64 * 100.0),
        memory_used: used,
        memory_total: total,
        download: elapsed.map(|s| rx as f64 / s.max(0.001)),
        upload: elapsed.map(|s| tx as f64 / s.max(0.001)),
        ports: if ports {
            crate::system::listener_count().ok()
        } else {
            None
        },
    };
    m.cached = Some((now, stats.clone()));
    stats
}

#[tauri::command]
pub fn floating_toggle_main(app: tauri::AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("主窗口不可用")?;
    let visible = main.is_visible().map_err(|e| e.to_string())?;
    let minimized = main.is_minimized().map_err(|e| e.to_string())?;
    if visible && !minimized {
        main.hide().map_err(|e| e.to_string())
    } else {
        floating_open_main(app)
    }
}
#[tauri::command]
pub fn floating_open_main(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = app.show();
    let main = app.get_webview_window("main").ok_or("主窗口不可用")?;
    main.show().map_err(|e| e.to_string())?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn floating_menu(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
    let config = app.state::<FloatingState>().config.lock().unwrap().clone();
    let menu = Menu::new(&app).map_err(|e| e.to_string())?;
    for (id, label) in METRICS {
        let checked = config.metrics.iter().any(|m| m == id);
        let enabled = if checked {
            config.metrics.len() > 1
        } else {
            config.metrics.len() < 3
        };
        menu.append(
            &CheckMenuItem::with_id(
                &app,
                format!("floating:metric:{id}"),
                label,
                enabled,
                checked,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    menu.append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    for (id, label) in [
        ("open", "打开 Portside"),
        ("hide", "隐藏悬浮球"),
        ("quit", "退出 Portside"),
    ] {
        menu.append(
            &MenuItem::with_id(&app, format!("floating:{id}"), label, true, None::<&str>)
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    let window = app.get_webview_window("floating").ok_or("悬浮球不可用")?;
    window.popup_menu(&menu).map_err(|e| e.to_string())?;
    *app.state::<FloatingState>()
        .menu
        .lock()
        .map_err(|e| e.to_string())? = Some(menu);
    Ok(())
}
pub fn menu_event(app: &tauri::AppHandle, id: &str) {
    if id == "floating:open" {
        let _ = floating_open_main(app.clone());
    } else if id == "floating:quit" {
        app.exit(0);
    } else if id == "floating:hide" {
        let _ = app.emit_to(
            "main",
            "floating-change",
            serde_json::json!({"enabled":false}),
        );
    } else if let Some(metric) = id.strip_prefix("floating:metric:") {
        let mut config = app.state::<FloatingState>().config.lock().unwrap().clone();
        if config.metrics.iter().any(|id| id == metric) {
            if config.metrics.len() == 1 {
                return;
            }
            config.metrics.retain(|id| id != metric);
        } else if config.metrics.len() < 3 && METRICS.iter().any(|(id, _)| *id == metric) {
            config.metrics.push(metric.into());
        } else {
            return;
        }
        let _ = app.emit_to(
            "main",
            "floating-change",
            serde_json::json!({"metrics":config.metrics}),
        );
    }
}
pub fn moved(window: &tauri::Window) {
    if window.label() != "floating" {
        return;
    }
    let app = window.app_handle().clone();
    let revision = app
        .state::<FloatingState>()
        .revision
        .fetch_add(1, Ordering::AcqRel)
        + 1;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(220));
        if app
            .state::<FloatingState>()
            .revision
            .load(Ordering::Acquire)
            != revision
        {
            return;
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(window) = handle.get_webview_window("floating") else {
                return;
            };
            let _ = place(&window, true);
            if let (Ok(file), Ok(position)) = (position_file(&handle), window.outer_position()) {
                if let Some(parent) = file.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Ok(bytes) = serde_json::to_vec(&[position.x, position.y]) {
                    let _ = std::fs::write(file, bytes);
                }
            }
        });
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_meter_reuses_samples_without_resetting_deltas() {
        let mut meter = Meter::default();
        let first = sample_meter(&mut meter, false);
        assert!(first.memory_total > 0);
        assert!(first.memory_used <= first.memory_total);
        assert!(first.cpu.is_none());
        let previous = meter.previous;
        let second = sample_meter(&mut meter, false);
        assert_eq!(meter.previous, previous);
        assert_eq!(first.memory_used, second.memory_used);
        assert_eq!(first.download, second.download);
        std::thread::sleep(std::time::Duration::from_millis(1050));
        let third = sample_meter(&mut meter, false);
        assert!(meter.previous > previous);
        assert!(third.cpu.is_some_and(|cpu| (0.0..=100.0).contains(&cpu)));
        assert!(third.download.is_some_and(|speed| speed >= 0.0));
        assert!(third.upload.is_some_and(|speed| speed >= 0.0));
    }
    #[test]
    fn metric_limits() {
        let mut c = Config::default();
        assert!(c.validate().is_ok());
        c.metrics = vec![];
        assert!(c.validate().is_err());
        c.metrics = vec!["cpu".into(); 2];
        assert!(c.validate().is_err());
        c.metrics = vec!["cpu".into(), "memory".into(), "ports".into()];
        assert!(c.validate().is_ok());
        c.metrics.push("upload".into());
        assert!(c.validate().is_err());
    }
    #[test]
    fn geometry_clamps_and_snaps() {
        let area = tauri::PhysicalRect {
            position: PhysicalPosition::new(-1920, 0),
            size: tauri::PhysicalSize::new(1920, 1080),
        };
        assert_eq!(
            clamp_position(4000, 5000, 160, 64, area, 8, false),
            (-168, 1008)
        );
        assert_eq!(
            clamp_position(-1800, 500, 160, 64, area, 8, true),
            (-1912, 500)
        );
    }
}
