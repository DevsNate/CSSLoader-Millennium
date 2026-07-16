#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]
use std::io::Cursor;
use std::path::{Path, PathBuf};
use directories::BaseDirs;
use home::home_dir;
use zip_extract;
use std::process::Command;
use std::{fs, ptr};

#[cfg(target_os = "windows")]
use {
  winapi::um::tlhelp32::{CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32},
  winapi::um::processthreadsapi::{OpenProcess, TerminateProcess},
  winapi::um::winnt::{PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
  winapi::um::handleapi::CloseHandle,
  winapi::shared::minwindef::DWORD,
  winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
  winreg::RegKey,
};


#[cfg(target_os = "windows")]
fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![download_template,kill_standalone_backend,start_backend,install_bundled_backend,get_string_startup_dir])
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

  let mut home = home_dir().expect("");
  if home.join("homebrew/themes").exists() {
    home = home.join("homebrew/themes")
  }

  let url: String = "https://api.deckthemes.com/themes/template/css?themename=".to_owned() + &template_name;
  let client: reqwest::Client = reqwest::Client::new();
  let res: reqwest::Response = client.get(url).send().await.expect("");
  let bytes = res.bytes().await.expect("");

  let vec: Vec<u8> = bytes.to_vec();

  let extract = zip_extract::extract(Cursor::new(vec), &home, false);
  return !extract.is_err()
}

#[cfg(target_os = "windows")]
async fn get_startup_dir() -> Option<PathBuf> {
  if let Some(base_dirs) = BaseDirs::new() {
    let config = base_dirs.config_dir();
    let startup_dir: std::path::PathBuf = Path::new(&config).join("Microsoft\\Windows\\Start Menu\\Programs\\Startup");
    // TODO: MAKE SURE THE FILE OR DIRECTORY EXISTS
    // MAYBE NOT THE FILE AS ON INITIAL INSTALL IT WONT EXIST
    // BUT THE FOLDER FOR SURE
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
  let backend_file_name = startup_dir.unwrap().join("CssLoader-Standalone-Headless.exe");
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
fn install_companion_plugin(app: &tauri::AppHandle) -> Result<(), String> {
  let steam_path = get_steam_path()?;
  let plugin_target = steam_path
    .join("millennium")
    .join("plugins")
    .join("css-loader-runtime");

  let plugin_files = [
    "plugin.json",
    "backend/main.lua",
    ".millennium/Dist/index.js",
  ];

  for relative_path in plugin_files {
    let resource_path = format!("resources/css-loader-runtime/{}", relative_path);
    let source = app
      .path_resolver()
      .resolve_resource(&resource_path)
      .ok_or_else(|| format!("Bundled companion file was not found: {}", relative_path))?;
    let destination = plugin_target.join(relative_path.replace('/', "\\"));
    if let Some(parent) = destination.parent() {
      fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create companion plugin directory: {}", error))?;
    }
    fs::copy(&source, &destination)
      .map_err(|error| format!("Cannot install companion file {}: {}", relative_path, error))?;
  }

  let config_path = steam_path.join("millennium").join("config").join("config.json");
  let config_text = fs::read_to_string(&config_path)
    .map_err(|error| format!("Cannot read Millennium config: {}", error))?;
  let mut config: serde_json::Value = serde_json::from_str(&config_text)
    .map_err(|error| format!("Cannot parse Millennium config: {}", error))?;
  let enabled_plugins = config
    .pointer_mut("/plugins/enabledPlugins")
    .and_then(serde_json::Value::as_array_mut)
    .ok_or_else(|| String::from("Millennium config has no enabledPlugins list"))?;

  let already_enabled = enabled_plugins
    .iter()
    .any(|value| value.as_str() == Some("css-loader-runtime"));
  if !already_enabled {
    let backup_path = config_path.with_file_name("config.json.css-loader-backup");
    fs::copy(&config_path, backup_path)
      .map_err(|error| format!("Cannot back up Millennium config: {}", error))?;
    enabled_plugins.push(serde_json::Value::String(String::from("css-loader-runtime")));
    let updated = serde_json::to_string_pretty(&config)
      .map_err(|error| format!("Cannot serialize Millennium config: {}", error))?;
    fs::write(&config_path, updated + "\n")
      .map_err(|error| format!("Cannot update Millennium config: {}", error))?;
  }

  Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn install_bundled_backend(app: tauri::AppHandle) -> String {
  let source = match app
    .path_resolver()
    .resolve_resource("resources/CssLoader-Standalone-Headless.exe")
  {
    Some(path) => path,
    None => return String::from("ERROR: Bundled Millennium backend was not found"),
  };

  let destination = match get_backend_path().await {
    Some(path) => path,
    None => return String::from("ERROR: Cannot find the Windows Startup folder"),
  };

  let _ = kill_standalone_backend().await;

  if let Err(error) = fs::copy(&source, &destination) {
    return format!("ERROR: Failed to install bundled Millennium backend: {}", error);
  }

  if let Err(error) = install_companion_plugin(&app) {
    return format!("ERROR: Failed to install Millennium companion: {}", error);
  }

  start_backend(app).await
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn start_backend(app: tauri::AppHandle) -> String {
  let file = match get_backend_path().await {
    Some(path) => path,
    None => return String::from("ERROR: Cannot find the Windows Startup folder"),
  };

  if !file.exists() {
    let source = match app
      .path_resolver()
      .resolve_resource("resources/CssLoader-Standalone-Headless.exe")
    {
      Some(path) => path,
      None => return String::from("ERROR: Bundled Millennium backend was not found"),
    };

    if let Some(parent) = file.parent() {
      if let Err(error) = fs::create_dir_all(parent) {
        return format!("ERROR: Cannot create the Windows Startup folder: {}", error);
      }
    }

    if let Err(error) = fs::copy(&source, &file) {
      return format!("ERROR: Cannot restore the bundled backend: {}", error);
    }
  }

  println!("Starting New {}", &file.to_string_lossy());
  if let Err(error) = Command::new(&file).spawn() {
    return format!("ERROR: Failed to start the backend: {}", error);
  }
  println!("Started");
  return String::from("SUCCESS");
}

#[cfg(target_os = "windows")]
async fn find_standalone_pids() -> Option<Vec<u32>> {

  let process_name: &str = "CssLoader-Standalone-Headless.exe";

  unsafe {
      let snapshot_handle = CreateToolhelp32Snapshot(winapi::um::tlhelp32::TH32CS_SNAPPROCESS, 0);

      if snapshot_handle == ptr::null_mut() {
          println!("Failed to create snapshot. Error code: {}", winapi::um::errhandlingapi::GetLastError());
          return None;
      }

      let mut process_entry: PROCESSENTRY32 = std::mem::zeroed();
      process_entry.dwSize = std::mem::size_of::<PROCESSENTRY32>() as DWORD;

      if Process32First(snapshot_handle, &mut process_entry) != 0 {
          let mut entries: Vec<u32> = Vec::new();
          loop {
              let exe_name = std::ffi::CStr::from_ptr(process_entry.szExeFile.as_ptr() as *const i8).to_string_lossy();

              if exe_name == process_name {
                  let process_id = process_entry.th32ProcessID;

                  let process_handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, process_id);

                  if process_handle != ptr::null_mut() {
                      println!("Found process {} with PID: {}", process_name, process_id);
                      CloseHandle(process_handle);
                      entries.push(process_id);
                  } else {
                      println!("Failed to open process. Error code: {}", winapi::um::errhandlingapi::GetLastError());
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
    return String::from("ERROR: No Process Id")
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
        println!("Failed to open process. Error code: {}", winapi::um::errhandlingapi::GetLastError());
        return format!("ERROR: Failed to open process. Error Code {}", winapi::um::errhandlingapi::GetLastError());
    }

    // Terminate the process
    let result = TerminateProcess(process_handle, 1);

    if result == 0 {
        println!("Failed to terminate process. Error code: {}", winapi::um::errhandlingapi::GetLastError());
    } else {
        println!("Process terminated successfully.");
    }

    // Close the process handle
    CloseHandle(process_handle);

    return String::from("SUCCESS:");
  }
}
