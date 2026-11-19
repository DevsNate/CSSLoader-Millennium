// Style delivery, replacing upstream's css_browserhook.py. Upstream queued
// adds and removes per tab and committed them over the CEF debugging port.
// The backend keeps every enabled inject in activation order (engine/inject.lua);
// each target here (a Steam window, a browser view, a web page) reconciles its
// <style> elements against that list: missing ones are appended, stale ones
// removed, the rest stay where they are. That is the order upstream's
// transactions produced: an inject that is injected again moves to the end.
import { compareTab, TabContext } from './tabs';

export type StyleItem = { id: string; css: string };
export type Scope = 'all' | 'desktop' | 'gamepad';
export type Style = StyleItem & { tabs: string[]; scope: Scope };

export interface StyleTarget {
  // null once the target is gone.
  context(): TabContext | null;
  sync(items: StyleItem[], rebuild: boolean): void | Promise<void>;
}

export type UiMode = 'desktop' | 'gamepad';

// Before the UI mode is known: the Big Picture window's URL names its user
// agent, "Valve Steam Gamepad". backend/engine/output.lua uses the same test.
const looksGamepad = (context: TabContext) => context.url.includes('Gamepad');

class StyleHub {
  private styles: Style[] = [];
  private targets = new Set<StyleTarget>();
  private uiMode: UiMode | null = null;
  private ready = false;
  private startupRead = false;

  // The served CreatePopup evaluates the backend's startup file the first time
  // it runs, just before it calls popupCreated. Same styles and ids as the
  // backend's list, so windows keep them when that list arrives.
  private readStartup() {
    if (this.startupRead) return;
    const items = (globalThis as any).__cssLoaderBoot?.d;
    if (!Array.isArray(items)) return;
    this.startupRead = true;
    this.styles = items
      .filter((item) => typeof item?.c === 'string' && Array.isArray(item?.t))
      .map((item) => ({ id: String(item.i), css: item.c, tabs: item.t.map(String), scope: item.s === 'desktop' || item.s === 'gamepad' ? item.s : 'all' }));
  }

  isReady() {
    return this.ready;
  }

  private scopeApplies(scope: Scope, context: TabContext): boolean {
    const mode = this.uiMode ?? (looksGamepad(context) ? 'gamepad' : 'desktop');
    return scope === 'all' || scope === mode;
  }

  itemsFor(context: TabContext): StyleItem[] {
    if (!this.ready) this.readStartup();
    return this.styles
      .filter((style) => this.scopeApplies(style.scope, context) && style.tabs.some((tab) => compareTab(tab, context)))
      .map(({ id, css }) => ({ id, css }));
  }

  register(target: StyleTarget) {
    this.targets.add(target);
    this.syncTarget(target);
  }

  unregister(target: StyleTarget) {
    this.targets.delete(target);
  }

  syncTarget(target: StyleTarget, rebuild = false) {
    const context = target.context();
    if (!context) {
      this.targets.delete(target);
      return;
    }
    try {
      const pending = target.sync(this.itemsFor(context), rebuild);
      if (pending) pending.catch((error) => console.warn('[CSS Loader] Style sync failed', error));
    } catch (error) {
      console.warn('[CSS Loader] Style sync failed', error);
    }
  }

  // upstream commit_all.
  private commit() {
    for (const target of [...this.targets]) this.syncTarget(target);
  }

  setStyles(styles: Style[]) {
    this.ready = true;
    this.styles = styles;
    this.commit();
  }

  setUiMode(mode: UiMode | null) {
    if (mode === this.uiMode) return;
    this.uiMode = mode;
    this.commit();
  }
}

export const hub = new StyleHub();

// The <style> reconcile shared by direct documents and, as source text, by
// browser targets (cdp.ts). Kept free of closures so it can be stringified.
export function reconcileStyles(doc: Document, items: StyleItem[], rebuild: boolean): void {
  const existing = new Map<string, HTMLStyleElement>();
  doc.querySelectorAll<HTMLStyleElement>('style.css-loader-style').forEach((style) => {
    if (rebuild || existing.has(style.id) || !items.some((item) => item.id === style.id)) style.remove();
    else existing.set(style.id, style);
  });
  const parent = doc.head ?? doc.documentElement;
  for (const item of items) {
    if (existing.has(item.id)) continue;
    const style = doc.createElement('style');
    style.id = item.id;
    style.classList.add('css-loader-style');
    style.textContent = item.css;
    parent.append(style);
  }
}
