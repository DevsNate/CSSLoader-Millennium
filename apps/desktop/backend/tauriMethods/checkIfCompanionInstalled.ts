export async function checkIfCompanionInstalled() {
  const { invoke } = await import("@tauri-apps/api");
  return await invoke<boolean>("companion_installed", {});
}
