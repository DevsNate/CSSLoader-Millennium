export async function ensureInstallation() {
  const { invoke } = await import("@tauri-apps/api");
  const result = await invoke<string>("ensure_installation", {});
  if (result.startsWith("ERROR")) {
    throw new Error(result);
  }
  return result;
}

export async function ensureThemeLibrary() {
  const { invoke } = await import("@tauri-apps/api");
  const result = await invoke<string>("ensure_theme_library", {});
  if (result.startsWith("ERROR")) {
    throw new Error(result);
  }
  return result;
}
