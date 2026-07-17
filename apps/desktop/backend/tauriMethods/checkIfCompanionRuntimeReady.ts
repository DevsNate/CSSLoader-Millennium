export async function checkIfCompanionRuntimeReady() {
  const { invoke } = await import("@tauri-apps/api");
  return await invoke<boolean>("companion_runtime_ready", {});
}
