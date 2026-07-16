export async function checkIfStandaloneBackendExists() {
  const { invoke } = await import("@tauri-apps/api");
  return await invoke<boolean>("installation_complete", {});
}
