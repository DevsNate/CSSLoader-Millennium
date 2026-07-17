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
const BACKEND_FILE_NAME: &str = "CSS Loader for Millennium Backend.exe";
#[cfg(target_os = "windows")]
const LEGACY_BACKEND_FILE_NAME: &str = "CssLoader-Standalone-Headless.exe";
#[cfg(target_os = "windows")]
const BACKEND_AUTORUN_NAME: &str = "CSS Loader for Millennium Backend";
#[cfg(target_os = "windows")]
const WINDOWS_RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

#[cfg(target_os = "windows")]
use {
    std::ffi::OsStr,
    std::os::windows::ffi::OsStrExt,
    winapi::shared::minwindef::DWORD,
    winapi::shared::winerror::ERROR_ALREADY_EXISTS,
    winapi::um::errhandlingapi::GetLastError,
    winapi::um::handleapi::CloseHandle,
    winapi::um::processthreadsapi::{OpenProcess, TerminateProcess},
    winapi::um::synchapi::CreateMutexW,
    winapi::um::tlhelp32::{
        CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32,
    },
    winapi::um::winnt::{PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
    winapi::um::winuser::{FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE},
    winreg::enums::HKEY_CURRENT_USER,
    winreg::RegKey,
};

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

#[cfg(target_os = "windows")]
fn acquire_single_instance() -> Option<winapi::shared::ntdef::HANDLE> {
    let mutex_name = wide_null("Local\\CSSLoaderForMillenniumDesktop");
    let mutex = unsafe { CreateMutexW(ptr::null_mut(), 0, mutex_name.as_ptr()) };

    if mutex.is_null() {
        // Do not make a transient mutex failure prevent the app from opening.
        return Some(mutex);
    }

    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        let window_title = wide_null("CSS Loader for Millennium");
        let window = unsafe { FindWindowW(ptr::null(), window_title.as_ptr()) };
        if !window.is_null() {
            unsafe {
                ShowWindow(window, SW_RESTORE);
                SetForegroundWindow(window);
            }
        }
        unsafe { CloseHandle(mutex) };
        return None;
    }

    Some(mutex)
}

#[cfg(target_os = "windows")]
fn main() {
    let single_instance = match acquire_single_instance() {
        Some(handle) => handle,
        None => return,
    };

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

    if !single_instance.is_null() {
        unsafe { CloseHandle(single_instance) };
    }
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
fn get_startup_dir() -> Option<PathBuf> {
    if let Some(base_dirs) = BaseDirs::new() {
        let config = base_dirs.config_dir();
        let startup_dir: std::path::PathBuf =
            Path::new(&config).join("Microsoft\\Windows\\Start Menu\\Programs\\Startup");
        return Some(startup_dir);
    }
    return None;
}

#[cfg(target_os = "windows")]
fn get_backend_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path_resolver()
        .resolve_resource(format!(
            "resources/css-loader-backend/{}",
            BACKEND_FILE_NAME
        ))
        .ok_or_else(|| String::from("Bundled onedir backend launcher was not found"))
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_string_startup_dir(app: tauri::AppHandle) -> String {
    match get_backend_path(&app)
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
    {
        Some(path) => path.to_string_lossy().to_string(),
        None => String::from("ERROR: Bundled backend directory was not found"),
    }
}

#[cfg(target_os = "windows")]
fn autorun_command(backend: &Path) -> String {
    format!("\"{}\"", backend.to_string_lossy())
}

#[cfg(target_os = "windows")]
fn register_backend_autorun(backend: &Path) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = hkcu
        .create_subkey(WINDOWS_RUN_KEY)
        .map_err(|error| format!("Cannot open the Windows autorun registry key: {}", error))?;
    run_key
        .set_value(BACKEND_AUTORUN_NAME, &autorun_command(backend))
        .map_err(|error| format!("Cannot register the backend for login startup: {}", error))
}

#[cfg(target_os = "windows")]
fn backend_autorun_is_current(backend: &Path) -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey(WINDOWS_RUN_KEY)
        .ok()
        .and_then(|key| key.get_value::<String, _>(BACKEND_AUTORUN_NAME).ok())
        .map(|value| value == autorun_command(backend))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
async fn remove_legacy_startup_backends() -> Result<(), String> {
    let startup_dir = match get_startup_dir() {
        Some(path) => path,
        None => return Ok(()),
    };
    let legacy_paths = [
        startup_dir.join(BACKEND_FILE_NAME),
        startup_dir.join(LEGACY_BACKEND_FILE_NAME),
    ];
    if legacy_paths.iter().any(|path| path.exists()) {
        let _ = kill_standalone_backend().await;
    }
    for path in legacy_paths {
        if path.exists() {
            fs::remove_file(&path).map_err(|error| {
                format!("Cannot remove legacy backend {}: {}", path.display(), error)
            })?;
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn ensure_bundled_installation(
    app: &tauri::AppHandle,
    _overwrite_backend: bool,
) -> Result<(), String> {
    theme_library_path()?;
    let backend = get_backend_path(app)?;
    let internal = backend
        .parent()
        .ok_or_else(|| String::from("Bundled backend has no parent directory"))?
        .join("_internal");
    if !backend.is_file() || !internal.is_dir() {
        return Err(String::from("The installed onedir backend is incomplete"));
    }
    remove_legacy_startup_backends().await?;
    register_backend_autorun(&backend)?;
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
async fn installation_complete(app: tauri::AppHandle) -> bool {
    let backend = match get_backend_path(&app) {
        Ok(path) => path,
        Err(_) => return false,
    };
    if !backend.is_file() {
        return false;
    }
    backend
        .parent()
        .map(|path| path.join("_internal").is_dir())
        .unwrap_or(false)
        && backend_autorun_is_current(&backend)
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn install_bundled_backend(app: tauri::AppHandle) -> String {
    let _ = kill_standalone_backend().await;
    if let Err(error) = ensure_bundled_installation(&app, true).await {
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
    let file = match get_backend_path(&app) {
        Ok(path) => path,
        Err(error) => return format!("ERROR: {}", error),
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
