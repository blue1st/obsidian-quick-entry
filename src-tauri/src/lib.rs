use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

#[derive(serde::Serialize)]
struct CliTypeInfo {
    exists: bool,
}

fn resolve_obsidian_cli() -> Option<std::path::PathBuf> {
    let path_env = std::env::var_os("PATH")?;
    let paths = std::env::split_paths(&path_env);
    
    for path in paths {
        let file_names = ["obsidian", "Obsidian"];
        for name in &file_names {
            let file_path = path.join(name);
            if file_path.is_file() {
                return Some(file_path);
            }
        }
    }
    None
}

#[derive(serde::Serialize)]
struct CommandOutput {
    code: i32,
    stdout: String,
    stderr: String,
}

#[tauri::command]
fn get_obsidian_cli_info() -> CliTypeInfo {
    match resolve_obsidian_cli() {
        Some(_) => CliTypeInfo { exists: true },
        None => CliTypeInfo { exists: false },
    }
}

#[tauri::command]
fn execute_obsidian_command(args: Vec<String>) -> Result<CommandOutput, String> {
    let program = resolve_obsidian_cli()
        .ok_or_else(|| "Obsidian CLI not found in PATH".to_string())?;

    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file_id = format!("{}_{}", timestamp, count);

    let temp_dir = std::env::temp_dir();
    let stdout_path = temp_dir.join(format!("obsidian_stdout_{}.log", file_id));
    let stderr_path = temp_dir.join(format!("obsidian_stderr_{}.log", file_id));

    let stdout_file = std::fs::File::create(&stdout_path)
        .map_err(|e| format!("Failed to create stdout temp file: {}", e))?;
    let stderr_file = std::fs::File::create(&stderr_path)
        .map_err(|e| format!("Failed to create stderr temp file: {}", e))?;

    let mut child = std::process::Command::new(program)
        .args(&args)
        .stdout(stdout_file)
        .stderr(stderr_file)
        .spawn()
        .map_err(|e| format!("Failed to spawn obsidian command: {}", e))?;

    let status = child.wait()
        .map_err(|e| format!("Failed to wait for obsidian command: {}", e))?;

    let stdout = std::fs::read_to_string(&stdout_path)
        .unwrap_or_else(|_| String::new());
    let stderr = std::fs::read_to_string(&stderr_path)
        .unwrap_or_else(|_| String::new());

    // Clean up temporary files
    let _ = std::fs::remove_file(&stdout_path);
    let _ = std::fs::remove_file(&stderr_path);

    let code = status.code().unwrap_or(-1);

    Ok(CommandOutput {
        code,
        stdout,
        stderr,
    })
}

#[tauri::command]
fn is_obsidian_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("tasklist")
            .args(&["/FI", "IMAGENAME eq Obsidian.exe"])
            .output();
        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            return stdout.contains("Obsidian.exe");
        }
        false
    }
    #[cfg(target_os = "macos")]
    {
        let pgrep_cmd = if std::path::Path::new("/usr/bin/pgrep").exists() {
            "/usr/bin/pgrep"
        } else {
            "pgrep"
        };

        let output = std::process::Command::new(pgrep_cmd)
            .args(&["-x", "Obsidian"])
            .output();
        if let Ok(out) = output {
            out.status.success()
        } else {
            false
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let pgrep_cmd = if std::path::Path::new("/usr/bin/pgrep").exists() {
            "/usr/bin/pgrep"
        } else {
            "pgrep"
        };

        let output = std::process::Command::new(pgrep_cmd)
            .args(&["-x", "obsidian"])
            .output();
        if let Ok(out) = output {
            out.status.success()
        } else {
            false
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    {
        // Add Homebrew, standard binary paths, and Obsidian app paths to PATH on macOS
        let mut paths = vec![
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
            "/Applications/Obsidian.app/Contents/MacOS".to_string(),
        ];
        if let Ok(home) = std::env::var("HOME") {
            paths.push(format!("{}/Applications/Obsidian.app/Contents/MacOS", home));
        }
        if let Ok(existing_path) = std::env::var("PATH") {
            paths.push(existing_path);
        }
        std::env::set_var("PATH", paths.join(":"));
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_obsidian_cli_info,
            execute_obsidian_command,
            is_obsidian_running
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let settings_i = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
            let reset_pos_i = MenuItem::with_id(app, "reset_position", "Reset Window Position", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_i, &reset_pos_i, &quit_i])?;

            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/trayTemplate.png"))?;
            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => {
                        if let Some(window) = app.get_webview_window("settings") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "reset_position" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.center();
                            let _ = window.set_focus();
                        }
                        if let Some(window) = app.get_webview_window("settings") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.center();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "quit" => {
                        std::process::exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                window.hide().unwrap();
                api.prevent_close();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

