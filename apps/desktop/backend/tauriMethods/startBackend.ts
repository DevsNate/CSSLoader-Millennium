export async function startBackend() {
  const { invoke } = await import("@tauri-apps/api");
  return await invoke<string>("start_backend", {});
}
