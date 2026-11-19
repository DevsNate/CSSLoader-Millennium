// Plugin entry. Upstream's frontend (src/) runs unchanged on the shim server,
// which calls the Lua backend; frontend/delivery gets its styles to the windows.
import './boot';
import { definePlugin } from 'millennium';
import { RiPaintFill } from 'react-icons/ri';
import { startDelivery } from './delivery';
import { setDesktopRouteMode } from './desktop-window/routes';
import { environment, loadEnvironment } from './engine/environment';
import { refreshStyles } from './engine/library';
import { startClassMappingFetch } from './engine/translations';
import { setWatching } from './engine/watch';
import { loadSettings, storeFlag } from './settings';
import { serverApi, setLibraryReady } from './shims/server';
import upstreamPlugin from '../src/index';
import { getInstalledThemes, globalState } from '../src/python';
import { Flags, type Theme } from '../src/ThemeTypes';

async function startLibrary() {
  await loadSettings();
  await loadEnvironment();
  await refreshStyles();
  startDelivery();

  startClassMappingFetch();
  if (storeFlag('watch', environment.flags)) await setWatching(true, true);
  // Themes installed before this plugin: learn their DeckThemes categories.
  // One request per call, so other backend calls never wait long behind it.
  for (let more = true; more;) {
    const step = await backend.refresh_catalog_scopes().catch(() => ({ changed: false, more: false }));
    if (step.changed) await refreshStyles();
    more = step.more;
  }
}

const library = startLibrary().catch((error) => console.error('[CSS Loader] Could not start', error));
setLibraryReady(library);

SteamClient.UI.GetUIMode().then(setDesktopRouteMode).catch(() => setDesktopRouteMode(7));
SteamClient.UI.RegisterForUIModeChanged(setDesktopRouteMode);

const upstream = upstreamPlugin(serverApi);

// Decky keeps upstream's panel mounted (alwaysRender), and two of its effects
// feed the store and settings pages. Millennium mounts it only while it's open.
const state = globalState!;
let seenThemes: Theme[] | undefined;
state.eventBus.addEventListener('stateUpdate', () => {
  const { localThemeList } = state.getPublicState();
  if (localThemeList === seenThemes) return;
  seenThemes = localThemeList;
  state.setGlobalState('selectedPreset', localThemeList.find((theme) => theme.flags.includes(Flags.isPreset) && theme.enabled));
});
getInstalledThemes();

export default definePlugin(() => ({
  title: 'CSS Loader',
  icon: <RiPaintFill />,
  content: upstream.content,
  titleView: upstream.titleView,
  alwaysRender: upstream.alwaysRender,
  onDismount: upstream.onDismount,
}));

// Called from Steam's served code (backend/main.lua patches).
/** @ffi */
export { popupCreated } from './delivery';
