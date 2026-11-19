// Settings live in Millennium's plugin config (config.json, plugins.css-loader.config).
// Upstream's store_read/store_write keys keep their names and string values;
// backend/main.lua imports them once from the old STORE file.
import { pluginConfig, subscribePluginConfig } from 'millennium';

type Listener = (key: string, value: unknown) => void;

const values = new Map<string, unknown>();
const listeners = new Set<Listener>();
let loading: Promise<void> | undefined;

export function loadSettings(): Promise<void> {
  loading ??= pluginConfig.getAll().then((stored) => {
    for (const [key, value] of Object.entries(stored ?? {})) values.set(key, value);
    // Millennium echoes changes from the backend or another context, never our own writes.
    subscribePluginConfig((key, value) => {
      if (value === null || value === undefined) values.delete(key);
      else values.set(key, value);
      listeners.forEach((listener) => listener(key, value));
    });
  }).catch((error) => {
    console.error('[CSS Loader] Settings could not be loaded; using defaults.', error);
    loading = undefined;
  });
  return loading;
}

export function readSetting<T>(key: string, fallback: T): T {
  return values.has(key) ? values.get(key) as T : fallback;
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
  // The SDK types the value as a string, but config takes any JSON value.
  await (pluginConfig.set as (key: string, value: unknown) => Promise<void>)(key, value);
  values.set(key, value);
  listeners.forEach((listener) => listener(key, value));
}

export function onSettingChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Upstream's STORE semantics: every value is a string, "" when unset.
export const storeRead = (key: string): string => {
  const value = readSetting<unknown>(key, '');
  return typeof value === 'string' ? value : JSON.stringify(value);
};
export const storeWrite = (key: string, value: string) => writeSetting(key, String(value).replace(/\n/g, ''));

// store_or_file_config: "True"/"1" in the store, or a flag file in the themes folder.
export const storeFlag = (key: string, fileFlags: Record<string, boolean>): boolean =>
  fileFlags[key] === true || ['True', '1', 'true'].includes(storeRead(key));
