// Pages that are not Steam popups in this context: browser views (store,
// community, overlay browser), and any Steam window the popup hook missed.
// Upstream reached every page over the CEF debugging port; this uses
// Millennium's per-plugin ChromeDevToolsProtocol, which needs no port.
import { ChromeDevToolsProtocol } from 'millennium';
import type { TabContext } from './tabs';
import { DIRECT_MARK } from './documents';
import { hub, reconcileStyles, StyleItem, StyleTarget } from './hub';

// The style files Millennium links into store pages (backend/engine/output.lua).
// Live changes arrive here instead, and the links are dropped.
const WEB_LINK_SELECTOR = 'link[href*="css-loader/web/"]';
const HEALTH_CHECK_MS = 3000;
const SKIP_TYPES = new Set(['service_worker', 'shared_worker', 'worker', 'browser']);

type TargetInfo = { targetId: string; type: string; title: string; url: string; attached?: boolean };

// CDP reports popups as about:blank; their documents say steamloopback.host.
const isSteamWindowUrl = (url: string) => url.startsWith('about:') || url.includes('steamloopback.host');

// Runs in the page; returns what compareTab needs, null for a document this
// context already styles directly, or undefined while there is no document.
const PROBE = `(() => {
  const d = document, e = d.documentElement;
  if (!e) return undefined;
  if (e.getAttribute(${JSON.stringify(DIRECT_MARK)}) === 'direct') return null;
  const l = (x) => (x ? [...x.classList] : []);
  const ids = [...d.querySelectorAll('style.css-loader-style')].map((x) => x.id);
  const links = d.querySelectorAll(${JSON.stringify(WEB_LINK_SELECTOR)}).length;
  return JSON.stringify({ context: { title: d.title, url: String(location.href), classes: [...l(e), ...l(d.body), ...l(d.head)] }, ids, links });
})()`;

const reconcileSource = reconcileStyles.toString();

// Applies the styles now, removes Millennium's served links (web.ts), and
// keeps CSS Loader's styles last in <head>.
const applyExpression = (items: StyleItem[], rebuild: boolean) => `(() => {
  const reconcile = ${reconcileSource};
  document.querySelectorAll(${JSON.stringify(WEB_LINK_SELECTOR)}).forEach((link) => link.remove());
  reconcile(document, ${JSON.stringify(items)}, ${rebuild});
  const head = document.head;
  if (head && !window.__cssLoaderKeepLast) {
    let moves = 0, since = Date.now();
    window.__cssLoaderKeepLast = new MutationObserver(() => {
      const ours = [...head.querySelectorAll(':scope > style.css-loader-style')];
      const tail = [...head.children].slice(-ours.length);
      if (!ours.length || tail.every((x, i) => x === ours[i])) return;
      if (Date.now() - since > 1000) { since = Date.now(); moves = 0; }
      if (++moves <= 20) head.append(...ours);
    });
    window.__cssLoaderKeepLast.observe(head, { childList: true });
  }
})()`;

// Registered for each page so a reload is styled at document start, before
// the first frame.
const documentStartSource = (items: StyleItem[]) => `(() => {
  const items = ${JSON.stringify(items)};
  const apply = () => {
    const parent = document.head || document.documentElement;
    if (!parent) return false;
    for (const item of items) {
      if (document.getElementById(item.id)) continue;
      const style = document.createElement('style');
      style.id = item.id;
      style.className = 'css-loader-style';
      style.textContent = item.css;
      parent.append(style);
    }
    return true;
  };
  if (!apply()) {
    const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
    observer.observe(document, { childList: true });
  }
})()`;

class CdpTab implements StyleTarget {
  sessionId: string | null = null;
  info: TargetInfo;
  probed: TabContext | null = null;
  // A document this context styles itself; never touched over CDP.
  direct = false;
  private scriptId: string | null = null;
  private lastItems = '';
  // Style ids the page had when last probed or synced.
  private present = '';
  // The page still has Millennium's served links (web.ts).
  private servedLinks = false;
  private pending: Promise<void> | null = null;
  closed = false;

  constructor(info: TargetInfo) {
    this.info = info;
  }

  context(): TabContext | null {
    if (this.closed) return null;
    return this.probed;
  }

  async attach(): Promise<boolean> {
    if (this.sessionId) return true;
    const reply: any = await ChromeDevToolsProtocol.send('Target.attachToTarget', { targetId: this.info.targetId, flatten: true });
    this.sessionId = reply?.sessionId ?? null;
    return !!this.sessionId;
  }

  probe(): Promise<void> {
    this.pending ??= this.probeNow().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async probeNow(): Promise<void> {
    if (!(await this.attach())) return;
    const reply: any = await ChromeDevToolsProtocol.send('Runtime.evaluate', { expression: PROBE, returnByValue: true }, this.sessionId!);
    const value = reply?.result?.value;
    if (value === null) {
      this.direct = true;
      await this.detach();
      return;
    }
    if (typeof value !== 'string') return;
    const parsed = JSON.parse(value);
    this.probed = parsed.context;
    this.present = JSON.stringify(parsed.ids);
    this.servedLinks = parsed.links > 0;
  }

  async sync(items: StyleItem[], rebuild: boolean) {
    if (!this.sessionId || this.direct) return;
    const key = JSON.stringify(items.map((item) => item.id));
    if (rebuild || key !== this.present || this.servedLinks) {
      await ChromeDevToolsProtocol.send('Runtime.evaluate', { expression: applyExpression(items, rebuild) }, this.sessionId);
      this.present = key;
      this.servedLinks = false;
    }
    if (key === this.lastItems) return;
    this.lastItems = key;
    if (this.scriptId) {
      await ChromeDevToolsProtocol.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.scriptId }, this.sessionId).catch(() => undefined);
      this.scriptId = null;
    }
    if (items.length === 0) return;
    const reply: any = await ChromeDevToolsProtocol.send(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: documentStartSource(items) },
      this.sessionId,
    ).catch(() => null);
    this.scriptId = reply?.identifier ?? null;
  }

  async detach() {
    const sessionId = this.sessionId;
    this.sessionId = null;
    if (sessionId) await ChromeDevToolsProtocol.send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
  }
}

const tabs = new Map<string, CdpTab>();
let ownTargetId: string | null = null;

const wanted = (info: TargetInfo) =>
  !SKIP_TYPES.has(info.type) && info.targetId !== ownTargetId && !info.url.startsWith('devtools://') && info.title !== 'SharedJSContext';

async function refresh(tab: CdpTab) {
  try {
    const before = tab.probed ? JSON.stringify(tab.probed) : '';
    await tab.probe();
    if (tab.direct) {
      hub.unregister(tab);
      return;
    }
    if (!tab.probed) return;
    if (!before) hub.register(tab);
    else if (before !== JSON.stringify(tab.probed)) hub.syncTarget(tab);
  } catch {
    // Targets come and go; the next check retries.
  }
}

function track(info: TargetInfo) {
  if (!wanted(info)) return;
  let tab = tabs.get(info.targetId);
  if (tab) {
    // A target can start as a Steam window and then navigate to the store.
    if (tab.direct && !isSteamWindowUrl(info.url)) tab.direct = false;
    tab.info = info;
    if (!tab.direct) void refresh(tab);
    return;
  }
  tab = new CdpTab(info);
  tabs.set(info.targetId, tab);
  void refresh(tab);
}

function forget(targetId: string) {
  const tab = tabs.get(targetId);
  if (!tab) return;
  tab.closed = true;
  tabs.delete(targetId);
  hub.unregister(tab);
}

async function healthCheck() {
  try {
    const reply: any = await ChromeDevToolsProtocol.send('Target.getTargets');
    const infos: TargetInfo[] = reply?.targetInfos ?? [];
    const seen = new Set(infos.map((info) => info.targetId));
    for (const id of [...tabs.keys()]) if (!seen.has(id)) forget(id);
    for (const info of infos) {
      const tab = tabs.get(info.targetId);
      // A page that reloaded lost its session's state but keeps the target.
      if (tab && !tab.direct && tab.probed) {
        tab.info = info;
        await refresh(tab);
        // Only sends anything when the page lost styles (a reload).
        if (!tab.direct) hub.syncTarget(tab);
      } else {
        track(info);
      }
    }
  } catch (error) {
    console.warn('[CSS Loader] Could not list pages', error);
  }
}

let started = false;

export async function startCdp() {
  if (started) return;
  started = true;
  try {
    const own: any = await ChromeDevToolsProtocol.send('Target.getTargetInfo').catch(() => null);
    ownTargetId = own?.targetInfo?.targetId ?? null;
  } catch {
    ownTargetId = null;
  }
  ChromeDevToolsProtocol.on('Target.targetCreated', ({ targetInfo }) => track(targetInfo as TargetInfo));
  ChromeDevToolsProtocol.on('Target.targetInfoChanged', ({ targetInfo }) => track(targetInfo as TargetInfo));
  ChromeDevToolsProtocol.on('Target.targetDestroyed', ({ targetId }) => forget(targetId));
  await healthCheck();
  setInterval(healthCheck, HEALTH_CHECK_MS);
}

export function cdpTabCount() {
  return [...tabs.values()].filter((tab) => tab.probed && !tab.direct).length;
}
