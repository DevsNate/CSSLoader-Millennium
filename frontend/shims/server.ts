// The one object upstream's frontend talks to. Same method names and
// { success, result } replies as decky-frontend-lib 3's ServerAPI, answered by
// the Lua backend instead of a Python one.
import { routerHook as millenniumRouterHook, toaster } from 'millennium';
import type { ReactElement } from 'react';
import { environment } from '../engine/environment';
import { fromBackendJson } from '../engine/files';
import { changing } from '../engine/library';
import { installTheme } from '../engine/store';
import { fetchClassMappings } from '../engine/translations';
import { isWatching, setWatching } from '../engine/watch';
import { storeRead, storeWrite } from '../settings';

type Reply<T = any> = { success: true; result: T } | { success: false; result: any };

const STORE_ORIGIN = 'https://api.deckthemes.com';

// Upstream's route components by path; the desktop window renders them too.
export const routes = new Map<string, () => ReactElement>();

let ready: Promise<unknown> = Promise.resolve();
export const setLibraryReady = (promise: Promise<unknown>) => {
  ready = promise;
};

async function dispatch(method: string, args: Record<string, any>): Promise<unknown> {
  await ready;
  switch (method) {
    case 'dummy_function': return true;
    case 'is_standalone':
    case 'get_server_state': return false;
    case 'enable_server': return { success: false, message: 'Nothing to do!' };
    case 'fetch_theme_path': return environment.themesPath;
    case 'get_backend_version': return environment.cssLoaderVersion;
    case 'get_themes': return fromBackendJson(await backend.get_themes());
    case 'get_last_load_errors': return fromBackendJson(await backend.get_last_load_errors());
    case 'set_theme_state': return changing(backend.set_theme_state(args.name, args.state, args.set_deps ?? true, args.set_deps_value ?? true));
    case 'set_patch_of_theme': return changing(backend.set_patch_of_theme(args.themeName, args.patchName, args.value));
    case 'set_component_of_theme_patch': return changing(backend.set_component_of_theme_patch(args.themeName, args.patchName, args.componentName, args.value));
    case 'reset': return fromBackendJson(await changing(backend.reset()));
    case 'delete_theme': return changing(backend.delete_theme(args.themeName));
    case 'generate_preset_theme': return backend.generate_preset_theme(args.name);
    case 'generate_preset_theme_from_theme_names': return backend.generate_preset_theme_from_theme_names(args.name, JSON.stringify(args.themeNames));
    case 'download_theme_from_url': return installTheme(args.id, fromBackendJson<{ name: string }[]>(await backend.get_themes()).map((theme) => theme.name));
    case 'store_read': return storeRead(args.key);
    case 'store_write': await storeWrite(args.key, args.val); return { success: true, message: 'Success' };
    case 'get_watch_state': return isWatching();
    case 'toggle_watch_state': return setWatching(args.enable ?? true, args.only_this_session ?? false);
    case 'fetch_class_mappings': await fetchClassMappings(); return { success: true, message: 'Success' };
    default: throw new Error(`Unknown method ${method}`);
  }
}

async function fetchNoCors(url: string, init: RequestInit = {}): Promise<Reply> {
  try {
    const target = new URL(url);
    if (target.origin !== STORE_ORIGIN || target.username || target.password) throw new Error(`Refused request to ${target.origin}`);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const token = /^Bearer (.+)$/.exec(headers.Authorization ?? '')?.[1] ?? '';
    const reply = await backend.store_request(init.method ?? 'GET', target.pathname + target.search, token, typeof init.body === 'string' ? init.body : '');
    if (!reply.success) return { success: false, result: reply.error };
    return { success: true, result: { status: reply.status, body: reply.body, headers: {} } };
  } catch (error) {
    return { success: false, result: String((error as Error)?.message ?? error) };
  }
}

async function openFilePicker(startPath: string, _includeFiles = true) {
  // The Big Picture window's SteamClient has no System API; this context's does.
  const picked: unknown = await (SteamClient as any).System.OpenFileDialog({
    strTitle: 'Choose an image',
    bChooseDirectory: false,
    strInitialFile: startPath,
    rgFilters: [{ strFileTypeName: 'Images', rFilePatterns: ['*.png', '*.jpg', '*.jpeg', '*.webp', '*.gif', '*.svg'], bUseAsDefault: true }],
  });
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (typeof path !== 'string' || !path) throw new Error('User Canceled');
  // Upstream splits the result on "/".
  const normal = path.replaceAll('\\', '/');
  return { path: normal, realpath: normal };
}

export const serverApi = {
  async callPluginMethod<_Args = {}, Result = any>(method: string, args: object): Promise<Reply<Result>> {
    try {
      return { success: true, result: await dispatch(method, args as Record<string, any>) as Result };
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      console.warn(`[CSS Loader] ${method}: ${message}`);
      return { success: false, result: message };
    }
  },
  fetchNoCors: fetchNoCors as <Result = any>(url: string, init?: RequestInit) => Promise<Reply<Result>>,
  openFilePicker,
  toaster: {
    toast: (data: { title: any; body: any; duration?: number }) => toaster.toast(data as any),
  },
  routerHook: {
    addRoute(path: string, component: () => ReactElement) {
      routes.set(path, component);
      millenniumRouterHook.removeRoute(path);
      // Not exact: the settings sidebar lives on /cssloader/settings/<page>.
      millenniumRouterHook.addRoute(path, component);
    },
    removeRoute(path: string) {
      routes.delete(path);
      millenniumRouterHook.removeRoute(path);
    },
  },
};

export type ServerAPI = typeof serverApi;
