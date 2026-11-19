// The desktop client has no /cssloader routes to navigate to, so upstream's
// pages open in a window of their own, with a small history of their own.
// Adapted from SteamGridDB-Millennium's popout.
import { Navigation, showModal } from 'millennium';
import { createContext, useEffect, useState } from 'react';
import { routes } from '../shims/server';
import { PageWindowBoundary } from './window-boundary';

export const WINDOW_TITLE = 'CSS Loader';
const ROUTE_PREFIX = '/cssloader/';
const DESKTOP_MODE = 7;
const PAGE_CLASS = 'cssLoaderDesktopPage';

let uiMode: number | null = null;
export const setDesktopRouteMode = (mode: number) => {
  uiMode = mode;
};

let history: string[] = [];
let modal: { Close(): void } | null = null;
let pageWindow: Window | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export const isDesktopPage = (owner: Window) => {
  try {
    return Boolean(owner.document?.querySelector(`.${PAGE_CLASS}`));
  } catch {
    return false;
  }
};

const desktopWindow = () => (globalThis as any).g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup ?? window;

// The path shown in our window, for pages that pick a tab from it (the
// settings sidebar); null outside our window.
export const DesktopPathContext = createContext<string | null>(null);

// A registered page, or the one a sub-path belongs to (/cssloader/settings/profiles
// is the settings page on its Profiles tab), as Steam's router matches them.
const pageFor = (path: string) => {
  const exact = routes.get(path);
  if (exact) return exact;
  let best: string | undefined;
  for (const route of routes.keys()) {
    if (path.startsWith(`${route}/`) && (!best || route.length > best.length)) best = route;
  }
  return best ? routes.get(best) : undefined;
};

const DesktopPages = () => {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((version) => version + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const path = history[history.length - 1] ?? null;
  const Page = path ? pageFor(path) : undefined;
  return (
    <PageWindowBoundary pageClass={PAGE_CLASS} onWindow={(owner) => { pageWindow = owner; }} onCancel={desktopNavigateBack}>
      <DesktopPathContext.Provider value={path}>{Page ? <Page /> : null}</DesktopPathContext.Provider>
    </PageWindowBoundary>
  );
};

const openWindow = () => {
  modal = showModal(<DesktopPages />, desktopWindow(), {
    strTitle: WINDOW_TITLE,
    bHideMainWindowForPopouts: false,
    bForcePopOut: true,
    popupHeight: 800,
    popupWidth: 1280,
    fnOnClose: () => {
      modal = null;
      pageWindow = null;
      history = [];
    },
  } as any);
};

// True when the path was handled here.
export function desktopNavigate(path: string): boolean {
  if (uiMode !== DESKTOP_MODE || !path.startsWith(ROUTE_PREFIX)) return false;
  const open = Boolean(pageWindow && !pageWindow.closed && modal);
  if (!open) {
    history = [path];
    openWindow();
    return true;
  }
  if (history[history.length - 1] !== path) history.push(path);
  changed();
  bringToFront();
  return true;
}

// The cog and download buttons are in Steam's window, which a click brings to
// the front; window.focus() from there doesn't raise ours. Steam raises its
// windows through their popup's Focus() (SteamClient.Window.BringToFront).
function bringToFront() {
  if (!pageWindow) return;
  try {
    const popups: any[] = [...((globalThis as any).g_PopupManager?.GetPopups?.() ?? [])];
    const popup = popups.find((entry) => entry?.m_popup === pageWindow);
    if (typeof popup?.Focus === 'function') {
      popup.Focus();
      return;
    }
    (pageWindow as any).SteamClient?.Window?.BringToFront?.();
  } catch {}
  pageWindow.focus();
}

export function desktopNavigateBack(): boolean {
  if (uiMode !== DESKTOP_MODE || !pageWindow || pageWindow.closed) return false;
  if (history.length > 1) {
    history.pop();
    changed();
  } else {
    pageWindow.close();
  }
  return true;
}

export { Navigation };
