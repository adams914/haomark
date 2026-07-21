// 好记 · Tauri 后端
// 提供文件读写命令，并处理通过文件关联（双击 .md）启动时传入的路径。
//
// v1.1 改进：
// - 原子写文件（write .tmp → fsync → rename），防断电/崩溃损坏
// - 文件编码探测（UTF-8 BOM / UTF-16 LE/BE / GBK / GB18030 自动转 UTF-8）
// - 关闭窗口前提示未保存（prevent_close + 事件转发给前端）
// - 单实例锁 + argv 转发（双击 .md 时若 app 已运行，转发给主实例）
// - 窗口状态记忆（位置/大小/最大化）

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;

/// 应用接受的扩展名（统一一处定义，避免四处漂移）。
/// 顺序与 pick_open_file / pick_save_file / 启动过滤器保持一致。
const ACCEPTED_EXTS: &[&str] = &["md", "markdown", "mdown", "mdx", "txt"];

/// 判断路径是否为应用支持的文件类型（用于启动参数过滤）。
fn is_accepted_path(p: &str) -> bool {
    let lower = p.to_lowercase();
    ACCEPTED_EXTS.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
}

/// 读取指定路径的文本文件。
/// 自动探测编码（UTF-8 BOM / UTF-16 LE+BE / GBK / GB18030），
/// 统一以 UTF-8 字符串返回（已剥除 BOM）。读取失败返回结构化错误。
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format_io_error(&path, &e))?;
    Ok(decode_bytes(&bytes))
}

/// 把内容原子写回指定路径。
/// 流程：写 `<path>.<pid>.tmp` → fsync → rename 到目标。
/// 中途失败不会损坏原文件。保留 UTF-8（无 BOM）输出。
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    write_atomic(&path, content.as_bytes()).map_err(|e| format_io_error(&path, &e))
}

/// 弹出"打开文件"对话框，返回选中文件的路径。
#[tauri::command]
async fn pick_open_file(app: tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Markdown", ACCEPTED_EXTS)
        .pick_file(move |file_path| {
            let resolved: Option<PathBuf> = match file_path {
                Some(f) => f.into_path().ok(),
                None => None,
            };
            let _ = tx.send(resolved);
        });
    Ok(rx.recv().map_err(|e| e.to_string())?)
}

/// 弹出"另存为"对话框，返回保存路径。
#[tauri::command]
async fn pick_save_file(
    app: tauri::AppHandle,
    default_name: Option<String>,
) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut builder = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdown", "mdx"]);
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    builder.save_file(move |file_path| {
        let resolved: Option<PathBuf> = match file_path {
            Some(f) => f.into_path().ok(),
            None => None,
        };
        let _ = tx.send(resolved);
    });
    Ok(rx.recv().map_err(|e| e.to_string())?)
}

/// 取走启动文件路径（双击 .md 打开时）。前端 ready 后调用一次取走。
#[tauri::command]
fn take_startup_file(state: State<'_, StartupFile>) -> Option<String> {
    state.0.lock().ok()?.take()
}

/// 加载持久化的 tab 列表（应用启动时恢复上次会话）。
/// 返回 JSON 字符串，前端解析。文件不存在返回空数组。
#[tauri::command]
fn load_tabs(app: tauri::AppHandle) -> Result<String, String> {
    let path = tabs_file_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("[]".to_string()),
        Err(e) => Err(format!("读取 tab 状态失败: {}", e)),
    }
}

/// 保存 tab 列表（防崩溃恢复 + 会话恢复）。
/// 原子写入（复用 write_atomic），避免崩溃损坏。
#[tauri::command]
fn save_tabs(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = tabs_file_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    write_atomic_path(&path, json.as_bytes()).map_err(|e| format!("保存 tab 状态失败: {}", e))
}

/// 拿 tab 状态文件路径：{app_data_dir}/tabs.json
fn tabs_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    Ok(dir.join("tabs.json"))
}

/// 按 PathBuf 原子写入（内部用，load_tabs/save_tabs 复用）。
fn write_atomic_path(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "无效路径：无父目录")
    })?;
    let tmp_path = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("haoji"),
        std::process::id()
    ));
    let mut file = fs::File::create(&tmp_path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&tmp_path, path)?;
    Ok(())
}

/// 启动时传入的文件路径（双击 .md 打开），用 Mutex 包裹供前端取走。
#[derive(Debug, Default)]
struct StartupFile(std::sync::Mutex<Option<String>>);

// ===== 编码探测与原子写 ================================================

/// 把字节流解码为 UTF-8 字符串。
/// 探测顺序：UTF-8 BOM → UTF-16 LE BOM → UTF-16 BE BOM → UTF-8（含纯 ASCII）→ GBK/GB18030。
/// 这覆盖了 Windows 记事本的常见保存格式。BOM 会被剥除。
fn decode_bytes(bytes: &[u8]) -> String {
    // UTF-8 BOM (EF BB BF)
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&bytes[3..]).into_owned();
    }
    // UTF-16 LE BOM (FF FE)
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return decode_utf16(&bytes[2..], true);
    }
    // UTF-16 BE BOM (FE FF)
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return decode_utf16(&bytes[2..], false);
    }
    // 尝试 UTF-8（严格）。成功就用它（最常见路径，零成本）。
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    // 最后兜底：按 GBK / GB18030 解码（中文 Windows 常见）。
    // encoding_rs 的 GB18030 解码器永不失败，最差也是替换字符。
    decode_gb18030(bytes)
}

/// UTF-16 解码。little_endian = true 为 LE，false 为 BE。
fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| {
            if little_endian {
                u16::from_le_bytes([chunk[0], chunk[1]])
            } else {
                u16::from_be_bytes([chunk[0], chunk[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

/// GBK / GB18030 解码（覆盖中文 Windows 的常见编码）。
fn decode_gb18030(bytes: &[u8]) -> String {
    // encoding_rs decode 返回 3 元组 (Cow<str>, &Encoding, had_errors)
    let (cow, _encoding, _had_errors) = encoding_rs::GB18030.decode(bytes);
    cow.into_owned()
}

/// 原子写入文件：写 .tmp → fsync → rename。
/// 目标文件存在时，原文件在中途任何失败下都保持完整。
fn write_atomic(path: &str, bytes: &[u8]) -> std::io::Result<()> {
    let target = Path::new(path);
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "无效路径：无父目录")
    })?;
    // 临时文件用 PID 后缀，避免多窗口并发写同名文件时互相干扰
    let tmp_path = parent.join(format!(
        ".{}.{}.tmp",
        target.file_name().and_then(|s| s.to_str()).unwrap_or("haoji"),
        std::process::id()
    ));
    // 1. 写临时文件
    let mut file = fs::File::create(&tmp_path)?;
    file.write_all(bytes)?;
    file.sync_all()?; // fsync：保证数据落盘
    drop(file);
    // 2. 原子 rename（Windows 上若目标存在会替换）
    fs::rename(&tmp_path, target)?;
    Ok(())
}

/// 把 io::Error 转成用户可读的中文消息，区分常见错误类型。
fn format_io_error(path: &str, e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => format!("文件不存在：{}", path),
        std::io::ErrorKind::PermissionDenied => format!("没有权限访问：{}", path),
        std::io::ErrorKind::InvalidData => {
            format!("文件损坏或编码无法识别：{}", path)
        }
        _ => format!("操作失败 {}: {}", path, e),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_fs::init())
            // 记住窗口大小/位置/最大化状态
            .plugin(tauri_plugin_window_state::Builder::default().build())
            // 单实例锁：双击 .md 时若 app 已运行，转发 argv 给主实例而非启动新进程
            .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                // 第二个实例的 argv[1] 是 .md 路径，emit 给前端打开
                if let Some(path) = argv.get(1).filter(|p| is_accepted_path(p)) {
                    // 前端监听 'open-file' 事件加载该文件
                    let _ = app.emit("open-file", path);
                    // 同时把窗口拉到前台
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_focus();
                        let _ = window.unminimize();
                    }
                }
            }));
    }

    builder
        .setup(|app| {
            // 日志：dev 用 Info，release 保留 Warn（生产事故可定位）
            let level = if cfg!(debug_assertions) {
                log::LevelFilter::Info
            } else {
                log::LevelFilter::Warn
            };
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(level)
                    .build(),
            )?;

            // 处理通过文件关联启动：argv 里的 .md 路径
            let startup_path = std::env::args()
                .nth(1)
                .filter(|p| is_accepted_path(p));

            app.manage(StartupFile(std::sync::Mutex::new(startup_path)));
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭请求：交给前端决定（前端可弹未保存确认框）。
            // 前端监听 close-requested 事件后，确认无误再调用 destroy()。
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            pick_open_file,
            pick_save_file,
            take_startup_file,
            load_tabs,
            save_tabs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
