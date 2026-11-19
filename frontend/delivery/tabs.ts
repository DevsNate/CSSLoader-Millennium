// Tab matching, ported from upstream's css_browserhook.py (BrowserTabHook.compare).
// backend/engine/tabs.lua resolves a theme's tab names; what's left is decided
// here, where the window is. backend/engine/output.lua carries a copy for
// windows created before the frontend loads, and scripts/checks keeps them in step.

export type TabContext = { title: string; url: string; classes: string[] };

const patternCache = new Map<string, RegExp | null>();

// ~text~ matches the URL, !class a class on <html>, <body> or <head>,
// anything else is a regex over the whole title.
export function compareTab(tab: string, context: TabContext): boolean {
  if (tab.length > 2 && tab.startsWith('~') && tab.endsWith('~')) return context.url.includes(tab.slice(1, -1));
  if (tab.startsWith('!')) return context.classes.includes(tab.slice(1));
  let pattern = patternCache.get(tab);
  if (pattern === undefined) {
    try {
      pattern = new RegExp(`^(${tab})$`);
    } catch {
      pattern = null;
    }
    patternCache.set(tab, pattern);
  }
  return pattern?.test(context.title) ?? false;
}
