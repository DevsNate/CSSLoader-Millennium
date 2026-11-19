// Starts style delivery: every Steam window and page, and the UI mode.
import { startCdp } from './cdp';
import { popupCreated, trackExistingWindows, trackWindow } from './documents';
import { hub, UiMode } from './hub';

// EUIMode: 4 is Big Picture, 7 the desktop client.
const toMode = (mode: number): UiMode | null => (mode === 4 ? 'gamepad' : mode === 7 ? 'desktop' : null);

// Store pages are shared between the modes, so the backend needs it as well.
const setMode = (mode: number) => {
  const uiMode = toMode(mode);
  hub.setUiMode(uiMode);
  backend.set_ui_mode(uiMode ?? '').catch((error) => console.warn('[CSS Loader] Could not report the UI mode', error));
};

// Before the backend's styles arrive, so windows opening meanwhile get the
// startup styles from here instead of the served hook.
export function startWindows() {
  trackWindow(window);
  trackExistingWindows();
  try {
    SteamClient.UI.RegisterForUIModeChanged(setMode);
    SteamClient.UI.GetUIMode().then(setMode).catch(() => undefined);
  } catch (error) {
    console.warn('[CSS Loader] Could not read the UI mode', error);
  }
}

export function startDelivery() {
  startCdp().catch((error) => console.warn('[CSS Loader] Could not watch pages', error));
}

export { popupCreated };
