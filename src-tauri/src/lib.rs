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

    let output = std::process::Command::new(program)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute obsidian command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let code = output.status.code().unwrap_or(-1);

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
    #[cfg(not(target_os = "windows"))]
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
            if out.status.success() {
                return true;
            }
        }
        
        let output2 = std::process::Command::new(pgrep_cmd)
            .args(&["-x", "obsidian"])
            .output();
        if let Ok(out2) = output2 {
            out2.status.success()
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
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_obsidian_cli_info,
            execute_obsidian_command,
            is_obsidian_running
        ])
        .setup(|app| {
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|_app, event| match event.id.as_ref() {
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

