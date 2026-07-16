export async function downloadBackend() {
  const { invoke } = await import("@tauri-apps/api");
  const result = await invoke<string>("install_bundled_backend", {});
  if (result.includes("ERROR")) {
    throw new Error(result);
  }
}
