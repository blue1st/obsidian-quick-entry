use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

#[derive(serde::Serialize)]
struct CliTypeInfo {
    exists: bool,
    needs_shell: bool,
}

#[tauri::command]
fn get_obsidian_cli_info() -> CliTypeInfo {
    let path_env = match std::env::var_os("PATH") {
        Some(path) => path,
        None => return CliTypeInfo { exists: false, needs_shell: false },
    };
    
    let paths = std::env::split_paths(&path_env);
    
    for path in paths {
        #[cfg(target_os = "windows")]
        {
            // First check direct executables
            let direct_exts = ["com", "exe"];
            for ext in &direct_exts {
                let file_path = path.join(format!("obsidian.{}", ext));
                if file_path.is_file() {
                    return CliTypeInfo { exists: true, needs_shell: false };
                }
            }
            
            // Then check shell scripts
            let shell_exts = ["cmd", "bat"];
            for ext in &shell_exts {
                let file_path = path.join(format!("obsidian.{}", ext));
                if file_path.is_file() {
                    return CliTypeInfo { exists: true, needs_shell: true };
                }
            }
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            let file_names = ["obsidian", "Obsidian"];
            for name in &file_names {
                let file_path = path.join(name);
                if file_path.is_file() {
                    return CliTypeInfo { exists: true, needs_shell: false };
                }
            }
        }
    }
    
    CliTypeInfo { exists: false, needs_shell: false }
}

#[tauri::command]
fn is_obsidian_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("tasklist")
            .args(&["/FI", "IMAGENAME eq Obsidian.exe", "/NH"])
            .output();
        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.contains("Obsidian.exe")
        } else {
            false
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("pgrep")
            .args(&["-x", "Obsidian"])
            .output();
        if let Ok(out) = output {
            if out.status.success() {
                return true;
            }
        }
        
        let output2 = std::process::Command::new("pgrep")
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
        .invoke_handler(tauri::generate_handler![get_obsidian_cli_info, is_obsidian_running])
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
