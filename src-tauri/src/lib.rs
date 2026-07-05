// 好记 · Tauri 后端
// 提供文件读写命令，并处理通过文件关联（双击 .md）启动时传入的路径。

use std::fs;
use std::path::PathBuf;
use tauri::{Manager, State, WindowEvent};

/// 读取指定路径的文本文件（UTF-8）。
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("读取失败 {}: {}", path, e))
}

/// 把内容写回指定路径（真正写回原文件，不再是浏览器下载）。
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("写入失败 {}: {}", path, e))
}

/// 弹出"打开文件"对话框，返回选中文件的路径。
#[tauri::command]
async fn pick_open_file(app: tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdown", "txt"])
        .pick_file(move |file_path| {
            // file_path 是 Option<FilePath>，FilePath.into_path() 返回 Result
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
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let mut builder = app.dialog().file().add_filter("Markdown", &["md", "markdown"]);
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

/// 启动时传入的文件路径（双击 .md 打开），用 Mutex 包裹供前端取走。
#[derive(Debug, Default)]
struct StartupFile(std::sync::Mutex<Option<String>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_fs::init());
    }

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 处理通过文件关联启动：argv 里的 .md 路径
            let startup_path = std::env::args()
                .nth(1)
                .filter(|p| {
                    let lower = p.to_lowercase();
                    lower.ends_with(".md")
                        || lower.ends_with(".markdown")
                        || lower.ends_with(".mdown")
                        || lower.ends_with(".mdx")
                        || lower.ends_with(".txt")
                });

            app.manage(StartupFile(std::sync::Mutex::new(startup_path)));
            Ok(())
        })
        .on_window_event(|window, event| {
            // 单窗口应用：关闭即退出
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 前端可监听 tauri.close-requested 做未保存提示；
                // 这里暂不阻止，直接退出
                let _ = (window, api);
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            pick_open_file,
            pick_save_file,
            take_startup_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
