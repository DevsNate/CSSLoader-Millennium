#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
use directories::BaseDirs;
use home::home_dir;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::{fs, ptr};
use zip_extract;

#[cfg(target_os = "windows")]
const COMPANION_ID: &str = "css-loader-companion";
#[cfg(target_os = "windows")]
const LEGACY_COMPANION_ID: &str = "css-loader-runtime";
#[cfg(target_os = "windows")]
const BACKEND_FILE_NAME: &str = "CSS Loader for Millennium Backend.exe";
#[cfg(target_os = "windows")]
const LEGACY_BACKEND_FILE_NAME: &str = "CssLoader-Standalone-Headless.exe";

#[cfg(target_os = "windows")]
use {
    winapi::shared::minwindef::DWORD,
    winapi::um::handleapi::CloseHandle,
    winapi::um::processthreadsapi::{OpenProcess, TerminateProcess},
    winapi::um::tlhelp32::{
        CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32,
    },
    winapi::um::winnt::{PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
    winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
    winreg::RegKey,
};

#[cfg(target_os = "windows")]
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            download_template,
            ensure_installation,
            ensure_theme_library,
            installation_complete,
            kill_standalone_backend,
            start_backend,
            install_bundled_backend,
            get_string_startup_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "linux")]
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![download_template])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn download_template(template_name: String) -> bool {
    let home = match theme_library_path() {
        Ok(path) => path,
        Err(_) => return false,
    };

    let url: String =
        "https://api.deckthemes.com/themes/template/css?themename=".to_owned() + &template_name;
    let client: reqwest::Client = reqwest::Client::new();
    let res: reqwest::Response = match client.get(url).send().await {
        Ok(response) => response,
        Err(_) => return false,
    };
    let bytes = match res.bytes().await {
        Ok(body) => body,
        Err(_) => return false,
    };

    let vec: Vec<u8> = bytes.to_vec();

    let extract = zip_extract::extract(Cursor::new(vec), &home, false);
    return !extract.is_err();
}

fn theme_library_path() -> Result<PathBuf, String> {
    let path = home_dir()
        .ok_or_else(|| String::from("Cannot find the current user's home directory"))?
        .join("homebrew")
        .join("themes");
    fs::create_dir_all(&path)
        .map_err(|error| format!("Cannot create the CSS Loader theme library: {}", error))?;
    Ok(path)
}

#[tauri::command]
fn ensure_theme_library() -> String {
    match theme_library_path() {
        Ok(path) => path.to_string_lossy().to_string(),
        Err(error) => format!("ERROR: {}", error),
    }
}

#[cfg(target_os = "windows")]
async fn get_startup_dir() -> Option<PathBuf> {
    if let Some(base_dirs) = BaseDirs::new() {
        let config = base_dirs.config_dir();
        let startup_dir: std::path::PathBuf =
            Path::new(&config).join("Microsoft\\Windows\\Start Menu\\Programs\\Startup");
        return Some(startup_dir);
    }
    return None;
}

#[cfg(target_os = "windows")]
async fn get_backend_path() -> Option<PathBuf> {
    let startup_dir = get_startup_dir().await;
    if startup_dir.is_none() {
        return None;
    }
    let backend_file_name = startup_dir.unwrap().join(BACKEND_FILE_NAME);
    return Some(backend_file_name);
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn get_string_startup_dir() -> String {
    let startup_dir = get_startup_dir().await;
    if startup_dir.is_none() {
        return "ERROR:".to_owned();
    }
    return startup_dir.unwrap().to_string_lossy().to_string();
}

#[cfg(target_os = "windows")]
fn get_steam_path() -> Result<PathBuf, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(steam_key) = hkcu.open_subkey("SOFTWARE\\Valve\\Steam") {
        if let Ok(steam_path) = steam_key.get_value::<String, _>("SteamPath") {
            return Ok(PathBuf::from(steam_path));
        }
    }

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let steam_key = hklm
        .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
        .map_err(|error| format!("Cannot find Steam in the Windows registry: {}", error))?;
    let install_path: String = steam_key
        .get_value("InstallPath")
        .map_err(|error| format!("Cannot read Steam's install path: {}", error))?;
    Ok(PathBuf::from(install_path))
}

#[cfg(target_os = "windows")]
fn enable_companion_in_config(config: &mut serde_json::Value) -> Result<bool, String> {
    let enabled_plugins = config
        .pointer_mut("/plugins/enabledPlugins")
        .and_then(serde_json::Value::as_array_mut)
        .ok_or_else(|| String::from("Millennium config has no enabledPlugins list"))?;

    let previous_length = enabled_plugins.len();
    enabled_plugins.retain(|value| value.as_str() != Some(LEGACY_COMPANION_ID));
    let removed_legacy_id = enabled_plugins.len() != previous_length;
    let already_enabled = enabled_plugins
        .iter()
        .any(|value| value.as_str() == Some(COMPANION_ID));
    if !already_enabled {
        enabled_plugins.push(serde_json::Value::String(String::from(COMPANION_ID)));
    }
    Ok(removed_legacy_id || !already_enabled)
}

#[cfg(target_os = "windows")]
fn install_companion_plugin(app: &tauri::AppHandle) -> Result<(), String> {
    let steam_path = get_steam_path()?;
    let plugins_root = steam_path.join("millennium").join("plugins");
    let plugin_target = plugins_root.join(COMPANION_ID);
    let legacy_plugin_target = plugins_root.join(LEGACY_COMPANION_ID);

    let plugin_files = [
        "plugin.json",
        "backend/main.lua",
        ".millennium/Dist/index.js",
    ];

    for relative_path in plugin_files {
        let resource_path = format!("resources/css-loader-companion/{}", relative_path);
        let source = app
            .path_resolver()
            .resolve_resource(&resource_path)
            .ok_or_else(|| format!("Bundled companion file was not found: {}", relative_path))?;
        let destination = plugin_target.join(relative_path.replace('/', "\\"));
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Cannot create companion plugin directory: {}", error))?;
        }
        fs::copy(&source, &destination).map_err(|error| {
            format!("Cannot install companion file {}: {}", relative_path, error)
        })?;
    }

    let config_path = steam_path
        .join("millennium")
        .join("config")
        .join("config.json");
    let config_text = fs::read_to_string(&config_path)
    .map_err(|error| format!(
      "Cannot read Millennium config at {}. Install Millennium and start Steam once, then retry: {}",
      config_path.display(),
      error
    ))?;
    let mut config: serde_json::Value = serde_json::from_str(&config_text)
        .map_err(|error| format!("Cannot parse Millennium config: {}", error))?;
    // Overlay mode must never replace the user's selected Millennium theme.
    let active_theme_before = config.pointer("/themes/activeTheme").cloned();
    let changed = enable_companion_in_config(&mut config)?;

    if changed {
        let backup_path = config_path.with_file_name("config.json.css-loader-backup");
        if !backup_path.exists() {
            fs::write(&backup_path, &config_text)
                .map_err(|error| format!("Cannot back up Millennium config: {}", error))?;
        }
        if config.pointer("/themes/activeTheme") != active_theme_before.as_ref() {
            return Err(String::from("Refusing to change Millennium's active theme"));
        }
        let updated = serde_json::to_string_pretty(&config)
            .map_err(|error| format!("Cannot serialize Millennium config: {}", error))?;
        fs::write(&config_path, updated + "\n")
            .map_err(|error| format!("Cannot update Millennium config: {}", error))?;
    }

    if legacy_plugin_target.exists() {
        fs::remove_dir_all(&legacy_plugin_target)
            .map_err(|error| format!("Cannot remove the previous companion version: {}", error))?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn companion_is_enabled(steam_path: &Path) -> bool {
    let config_path = steam_path
        .join("millennium")
        .join("config")
        .join("config.json");
    let config_text = match fs::read_to_string(config_path) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let config: serde_json::Value = match serde_json::from_str(&config_text) {
        Ok(value) => value,
        Err(_) => return false,
    };
    config
        .pointer("/plugins/enabledPlugins")
        .and_then(serde_json::Value::as_array)
        .map(|plugins| {
            plugins
                .iter()
                .any(|value| value.as_str() == Some(COMPANION_ID))
        })
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
async fn ensure_backend_file(app: &tauri::AppHandle, overwrite: bool) -> Result<PathBuf, String> {
    let destination = get_backend_path()
        .await
        .ok_or_else(|| String::from("Cannot find the Windows Startup folder"))?;
    let legacy_destination = destination.with_file_name(LEGACY_BACKEND_FILE_NAME);
    if legacy_destination.exists() {
        let _ = kill_standalone_backend().await;
        fs::remove_file(&legacy_destination)
            .map_err(|error| format!("Cannot remove the previous backend: {}", error))?;
    }
    if destination.exists() && !overwrite {
        return Ok(destination);
    }

    let source = app
        .path_resolver()
        .resolve_resource("resources/CSS Loader for Millennium Backend.exe")
        .ok_or_else(|| String::from("Bundled Millennium backend was not found"))?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create the Windows Startup folder: {}", error))?;
    }
    fs::copy(&source, &destination)
        .map_err(|error| format!("Cannot install the bundled Millennium backend: {}", error))?;
    Ok(destination)
}

#[cfg(target_os = "windows")]
async fn ensure_bundled_installation(
    app: &tauri::AppHandle,
    overwrite_backend: bool,
) -> Result<(), String> {
    theme_library_path()?;
    ensure_backend_file(app, overwrite_backend).await?;
    install_companion_plugin(app)?;
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn ensure_installation(app: tauri::AppHandle) -> String {
    match ensure_bundled_installation(&app, false).await {
        Ok(()) => String::from("SUCCESS"),
        Err(error) => format!("ERROR: {}", error),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn installation_complete() -> bool {
    let backend = match get_backend_path().await {
        Some(path) => path,
        None => return false,
    };
    if !backend.is_file() {
        return false;
    }

    let steam_path = match get_steam_path() {
        Ok(path) => path,
        Err(_) => return false,
    };
    let plugin_root = steam_path
        .join("millennium")
        .join("plugins")
        .join(COMPANION_ID);
    let required_plugin_files = [
        plugin_root.join("plugin.json"),
        plugin_root.join("backend").join("main.lua"),
        plugin_root
            .join(".millennium")
            .join("Dist")
            .join("index.js"),
    ];
    required_plugin_files.iter().all(|path| path.is_file()) && companion_is_enabled(&steam_path)
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn install_bundled_backend(app: tauri::AppHandle) -> String {
    if let Err(error) = theme_library_path().and_then(|_| install_companion_plugin(&app)) {
        return format!("ERROR: Failed to install CSS Loader: {}", error);
    }
    let _ = kill_standalone_backend().await;
    if let Err(error) = ensure_backend_file(&app, true).await {
        return format!("ERROR: Failed to install CSS Loader backend: {}", error);
    }

    start_backend(app).await
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn start_backend(app: tauri::AppHandle) -> String {
    if let Err(error) = ensure_bundled_installation(&app, false).await {
        return format!("ERROR: Cannot complete CSS Loader setup: {}", error);
    }
    let file = match get_backend_path().await {
        Some(path) => path,
        None => return String::from("ERROR: Cannot find the Windows Startup folder"),
    };

    println!("Starting New {}", &file.to_string_lossy());
    if let Err(error) = Command::new(&file).spawn() {
        return format!("ERROR: Failed to start the backend: {}", error);
    }
    println!("Started");
    return String::from("SUCCESS");
}

#[cfg(target_os = "windows")]
async fn find_standalone_pids() -> Option<Vec<u32>> {
    let process_names = [BACKEND_FILE_NAME, LEGACY_BACKEND_FILE_NAME];

    unsafe {
        let snapshot_handle = CreateToolhelp32Snapshot(winapi::um::tlhelp32::TH32CS_SNAPPROCESS, 0);

        if snapshot_handle == ptr::null_mut() {
            println!(
                "Failed to create snapshot. Error code: {}",
                winapi::um::errhandlingapi::GetLastError()
            );
            return None;
        }

        let mut process_entry: PROCESSENTRY32 = std::mem::zeroed();
        process_entry.dwSize = std::mem::size_of::<PROCESSENTRY32>() as DWORD;

        if Process32First(snapshot_handle, &mut process_entry) != 0 {
            let mut entries: Vec<u32> = Vec::new();
            loop {
                let exe_name =
                    std::ffi::CStr::from_ptr(process_entry.szExeFile.as_ptr() as *const i8)
                        .to_string_lossy();

                if process_names.iter().any(|name| exe_name == *name) {
                    let process_id = process_entry.th32ProcessID;

                    let process_handle =
                        OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, process_id);

                    if process_handle != ptr::null_mut() {
                        println!("Found process {} with PID: {}", exe_name, process_id);
                        CloseHandle(process_handle);
                        entries.push(process_id);
                    } else {
                        println!(
                            "Failed to open process. Error code: {}",
                            winapi::um::errhandlingapi::GetLastError()
                        );
                    }
                }

                if Process32Next(snapshot_handle, &mut process_entry) == 0 {
                    break;
                }
            }
            if entries.len() == 0 {
                return None;
            }
            return Some(entries);
        }

        CloseHandle(snapshot_handle);
        return None;
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn kill_standalone_backend() -> String {
    let process_ids: Option<Vec<u32>> = find_standalone_pids().await;

    if !process_ids.is_some() {
        return String::from("ERROR: No Process Id");
    }

    let entries: Vec<u32> = process_ids.unwrap();
    if entries.len() == 0 {
        return String::from("ERROR: Process IDs Length 0");
    }

    for id in entries.iter() {
        let res: String = kill_pid(id.to_owned()).await;

        if res.contains("ERROR") {
            return format!("ERROR: Error killing process, {}", res);
        }
    }
    return String::from("SUCCESS:");
}

#[cfg(target_os = "windows")]
async fn kill_pid(process_id: u32) -> String {
    unsafe {
        // Get a handle to the process
        let process_handle = winapi::um::processthreadsapi::OpenProcess(
            winapi::um::winnt::PROCESS_TERMINATE,
            0,
            process_id,
        );

        if process_handle.is_null() {
            println!(
                "Failed to open process. Error code: {}",
                winapi::um::errhandlingapi::GetLastError()
            );
            return format!(
                "ERROR: Failed to open process. Error Code {}",
                winapi::um::errhandlingapi::GetLastError()
            );
        }

        // Terminate the process
        let result = TerminateProcess(process_handle, 1);

        if result == 0 {
            println!(
                "Failed to terminate process. Error code: {}",
                winapi::um::errhandlingapi::GetLastError()
            );
        } else {
            println!("Process terminated successfully.");
        }

        // Close the process handle
        CloseHandle(process_handle);

        return String::from("SUCCESS:");
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{enable_companion_in_config, COMPANION_ID, LEGACY_COMPANION_ID};
    use serde_json::json;

    #[test]
    fn companion_migration_preserves_the_selected_theme() {
        let mut config = json!({
            "themes": { "activeTheme": "Steam" },
            "plugins": { "enabledPlugins": ["other-plugin", LEGACY_COMPANION_ID] }
        });

        assert!(enable_companion_in_config(&mut config).unwrap());
        assert_eq!(config.pointer("/themes/activeTheme"), Some(&json!("Steam")));
        let enabled = config
            .pointer("/plugins/enabledPlugins")
            .and_then(serde_json::Value::as_array)
            .unwrap();
        assert!(enabled.iter().any(|value| value == COMPANION_ID));
        assert!(!enabled.iter().any(|value| value == LEGACY_COMPANION_ID));
    }

    #[test]
    fn companion_migration_is_idempotent() {
        let mut config = json!({
            "themes": { "activeTheme": "default" },
            "plugins": { "enabledPlugins": [COMPANION_ID] }
        });

        assert!(!enable_companion_in_config(&mut config).unwrap());
        assert!(!enable_companion_in_config(&mut config).unwrap());
        assert_eq!(
            config
                .pointer("/plugins/enabledPlugins")
                .and_then(serde_json::Value::as_array)
                .unwrap()
                .len(),
            1
        );
    }
}
