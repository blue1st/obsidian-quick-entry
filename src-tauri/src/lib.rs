use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use std::path::PathBuf;
use std::collections::HashMap;

#[derive(serde::Serialize)]
struct CliTypeInfo {
    exists: bool,
    needs_shell: bool,
}

fn resolve_obsidian_cli() -> Option<(std::path::PathBuf, bool)> {
    let path_env = std::env::var_os("PATH")?;
    let paths = std::env::split_paths(&path_env);
    
    for path in paths {
        #[cfg(target_os = "windows")]
        {
            // First check direct executables
            let direct_exts = ["com", "exe"];
            for ext in &direct_exts {
                let file_path = path.join(format!("obsidian.{}", ext));
                if file_path.is_file() {
                    return Some((file_path, false));
                }
            }
            
            // Then check shell scripts
            let shell_exts = ["cmd", "bat"];
            for ext in &shell_exts {
                let file_path = path.join(format!("obsidian.{}", ext));
                if file_path.is_file() {
                    return Some((file_path, true));
                }
            }
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            let file_names = ["obsidian", "Obsidian"];
            for name in &file_names {
                let file_path = path.join(name);
                if file_path.is_file() {
                    return Some((file_path, false));
                }
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
        Some((_, needs_shell)) => CliTypeInfo { exists: true, needs_shell },
        None => CliTypeInfo { exists: false, needs_shell: false },
    }
}

#[tauri::command]
fn execute_obsidian_command(args: Vec<String>) -> Result<CommandOutput, String> {
    let (program, needs_shell) = resolve_obsidian_cli()
        .ok_or_else(|| "Obsidian CLI not found in PATH".to_string())?;

    let mut cmd = if needs_shell {
        let mut c = std::process::Command::new("cmd");
        c.arg("/c").arg(program);
        c
    } else {
        std::process::Command::new(program)
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW = 0x08000000
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.args(&args)
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

#[derive(serde::Deserialize)]
struct VaultInfo {
    path: String,
    ts: Option<u64>,
    open: Option<bool>,
}

#[derive(serde::Deserialize)]
struct ObsidianConfig {
    vaults: HashMap<String, VaultInfo>,
}

fn get_obsidian_config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join("Library/Application Support"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config"))
            })
    }
}

fn resolve_vault_path(vault_name: &str) -> Option<PathBuf> {
    let config_dir = get_obsidian_config_dir()?;
    let config_path = config_dir.join("obsidian").join("obsidian.json");
    if !config_path.exists() {
        return None;
    }
    let file = std::fs::File::open(config_path).ok()?;
    let config: ObsidianConfig = serde_json::from_reader(file).ok()?;
    
    if vault_name.is_empty() {
        let mut best_vault: Option<&VaultInfo> = None;
        for vault in config.vaults.values() {
            if vault.open.unwrap_or(false) {
                best_vault = Some(vault);
                break;
            }
            match (best_vault, vault.ts) {
                (None, _) => best_vault = Some(vault),
                (Some(best), Some(ts)) => {
                    if ts > best.ts.unwrap_or(0) {
                        best_vault = Some(vault);
                    }
                }
                _ => {}
            }
        }
        best_vault.map(|v| PathBuf::from(&v.path))
    } else {
        for vault in config.vaults.values() {
            let path = PathBuf::from(&vault.path);
            if let Some(name) = path.file_name() {
                if name.to_string_lossy().eq_ignore_ascii_case(vault_name) {
                    return Some(path);
                }
            }
        }
        None
    }
}

fn safe_join(vault_path: &std::path::Path, relative_path: &str) -> Result<PathBuf, String> {
    let path = std::path::Path::new(relative_path);
    for component in path.components() {
        if component == std::path::Component::ParentDir {
            return Err("Access denied: parent directory traversal is not allowed".to_string());
        }
    }
    let target_path = vault_path.join(relative_path);
    Ok(target_path)
}

#[tauri::command]
fn read_vault_file(vault_name: String, relative_path: String) -> Result<String, String> {
    let vault_path = resolve_vault_path(&vault_name)
        .ok_or_else(|| "Vault not found".to_string())?;
    
    let target_path = safe_join(&vault_path, &relative_path)?;
    
    if !target_path.exists() {
        return Err("File not found".to_string());
    }
    
    std::fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn write_vault_file(vault_name: String, relative_path: String, content: String) -> Result<(), String> {
    let vault_path = resolve_vault_path(&vault_name)
        .ok_or_else(|| "Vault not found".to_string())?;
    
    let target_path = safe_join(&vault_path, &relative_path)?;
    
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    
    std::fs::write(&target_path, content)
        .map_err(|e| format!("Failed to write file: {}", e))
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
            is_obsidian_running,
            read_vault_file,
            write_vault_file
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
