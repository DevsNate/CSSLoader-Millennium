// Windows Steam creates through g_PopupManager (desktop windows, menus,
// supernavs, friends, the Big Picture window). They share this JS context, so
// styles go straight into their documents, synchronously.
import type { TabContext } from './tabs';
import { hub, reconcileStyles, StyleItem, StyleTarget } from './hub';

const OWN_WINDOW = 'CSS Loader';

// Marks documents styled here, so the CDP path (cdp.ts) leaves them alone.
export const DIRECT_MARK = 'data-css-loader';

const STYLE_SELECTOR = 'style.css-loader-style';
// More than this many reorders per second means another script keeps moving
// its own styles last too; stop competing rather than loop.
const REORDER_LIMIT = 20;

const classList = (element: Element | null | undefined) => (element ? [...element.classList] : []);

class DocumentTab implements StyleTarget {
  private observer: MutationObserver | null = null;
  private lastKey = '';
  private reorders = 0;
  private reorderWindow = 0;

  constructor(readonly win: Window, readonly name: string) {}

  alive(): boolean {
    try {
      return !this.win.closed && !!this.win.document;
    } catch {
      return false;
    }
  }

  context(): TabContext | null {
    if (!this.alive()) return null;
    const doc = this.win.document;
    // document.open() gives a popup its opener's URL. Themes match the Big
    // Picture window on the address Steam created it with; backend/main.lua
    // does the same.
    const bigPicture = /^SP BPM/.test(this.name) || doc.title === 'Steam Big Picture Mode';
    return {
      title: doc.title,
      url: String(this.win.location.href) + (bigPicture ? ' Valve Steam Gamepad/default Valve%20Steam%20Gamepad/default' : ''),
      classes: [...classList(doc.documentElement), ...classList(doc.body), ...classList(doc.head)],
    };
  }

  sync(items: StyleItem[], rebuild: boolean) {
    const doc = this.win.document;
    doc.documentElement.setAttribute(DIRECT_MARK, 'direct');
    this.observe();
    reconcileStyles(doc, items, rebuild);
    this.keepLast();
  }

  // The title, URL and classes decide which styles a window gets; Steam sets
  // classes when it renders and changes titles as you navigate.
  private observe() {
    if (this.observer) return;
    const doc = this.win.document;
    const Observer = (this.win as any).MutationObserver ?? MutationObserver;
    this.lastKey = this.key();
    this.observer = new Observer((records: MutationRecord[]) => this.changed(records)) as MutationObserver;
    this.observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (doc.head) this.observer.observe(doc.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    if (doc.body) this.observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    else this.observer.observe(doc.documentElement, { childList: true });
  }

  private key() {
    const context = this.context();
    return context ? `${context.title}\n${context.url}\n${context.classes.join(' ')}` : '';
  }

  private changed(records: MutationRecord[]) {
    if (!this.alive()) return this.dispose();
    const doc = this.win.document;
    // <body> appeared after we started observing.
    if (doc.body && records.some((record) => record.target === doc.documentElement && record.type === 'childList')) {
      this.observer!.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    }
    const key = this.key();
    if (key !== this.lastKey) {
      this.lastKey = key;
      hub.syncTarget(this);
      return;
    }
    if (records.some((record) => record.type === 'childList' && record.target === doc.head)) this.keepLast();
  }

  // CSS Loader wins equal-specificity rules over Steam's and the Millennium
  // theme's sheets, as it does under Decky: its styles stay last in <head>.
  private keepLast() {
    const head = this.win.document.head;
    if (!head) return;
    const ours = [...head.querySelectorAll<HTMLStyleElement>(`:scope > ${STYLE_SELECTOR}`)];
    if (ours.length === 0) return;
    const tail = [...head.children].slice(-ours.length);
    if (tail.every((element, index) => element === ours[index])) return;

    const now = Date.now();
    if (now - this.reorderWindow > 1000) {
      this.reorderWindow = now;
      this.reorders = 0;
    }
    if (++this.reorders > REORDER_LIMIT) return;
    head.append(...ours);
  }

  dispose() {
    this.observer?.disconnect();
    this.observer = null;
    hub.unregister(this);
    tabs.delete(this.win);
  }
}

const tabs = new Map<Window, DocumentTab>();

export function trackWindow(win: Window | null | undefined, name = '') {
  if (!win || tabs.has(win)) return;
  try {
    if (win.closed || !win.document) return;
  } catch {
    return;
  }
  const tab = new DocumentTab(win, name);
  tabs.set(win, tab);
  win.addEventListener('pagehide', () => tab.dispose(), { once: true });
  win.addEventListener('unload', () => tab.dispose(), { once: true });
  hub.register(tab);
}

const popupWindow = (popup: any): Window | null => {
  const win = popup?.m_popup?.window ?? popup?.m_popup ?? popup?.window;
  try {
    return win?.document && !win.closed ? (win as Window) : null;
  } catch {
    return null;
  }
};

// Popups that were open before the plugin loaded.
export function trackExistingWindows() {
  const manager = (globalThis as any).g_PopupManager;
  const popups: unknown[] = [];
  try {
    const list = manager?.GetPopups?.() ?? manager?.m_mapPopups?.values?.() ?? [];
    for (const popup of list) popups.push(popup);
  } catch (error) {
    console.warn('[CSS Loader] Could not list Steam windows', error);
  }
  for (const popup of popups) {
    const name = String((popup as any)?.m_strName ?? '');
    if (name !== OWN_WINDOW) trackWindow(popupWindow(popup), name);
  }
}

/**
 * Called by the served CreatePopup (backend/main.lua patches) once a window's
 * document exists, before Steam renders into it. It must never throw into
 * Steam's code.
 */
export function popupCreated(name: string, win: Window) {
  try {
    // Our own window shows upstream's pages as they are, like a store page
    // without a theme; themes could otherwise hide the controls to undo them.
    if (name !== OWN_WINDOW) trackWindow(win, name);
  } catch (error) {
    console.error('[CSS Loader] Window setup', error);
  }
}

export function trackedDocumentCount() {
  return tabs.size;
}
