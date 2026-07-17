export async function takeRestartBackendRequest() {
  const { invoke } = await import("@tauri-apps/api");
  return await invoke<boolean>("take_restart_backend_request", {});
}
