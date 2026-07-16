import {
  callable,
  ChromeDevToolsProtocol,
  definePlugin,
  findSP,
  IconsModule,
  Millennium,
  PanelSection,
  PanelSectionRow,
} from '@steambrew/client';
import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 1000;
const getCssLoaderRevision = callable<[], string | false>('get_css_loader_revision');

let runtimeTimer: number | undefined;
let currentContentHash: string | undefined;
let currentReport: BuildReport | null = null;
let checkInProgress = false;
const knownDocuments = new Set<Document>();
const browserViewSessions = new Map<string, string>();

type BuildReport = {
  contentHash?: string;
  runtimeMode?: 'overlay';
  patches?: Array<{
    MatchRegexString?: string;
    TargetCss?: string;
  }>;
};

type TargetInfo = {
  targetId?: string;
  title?: string;
  type?: string;
};

const parseBuildReport = (revision: string): BuildReport | null => {
  try {
    return JSON.parse(revision) as BuildReport;
  } catch {
    return null;
  }
};

const liveDocument = (targetDocument: Document | null | undefined) => {
  if (targetDocument?.defaultView && !targetDocument.defaultView.closed) {
    knownDocuments.add(targetDocument);
  }
};

const collectSteamDocuments = () => {
  liveDocument(document);

  try {
    liveDocument(findSP()?.document);
  } catch {
    // Big Picture is not available in every Steam context.
  }

  try {
    const popups = Array.from((globalThis as any).g_PopupManager?.GetPopups?.() ?? []) as any[];
    popups.forEach((popup) => liveDocument(popup?.m_popup?.document));
  } catch {
    // Popup enumeration is best-effort across Steam UI versions.
  }
};

const isCssLoaderStylesheet = (link: HTMLLinkElement) => {
  try {
    const pathname = new URL(link.href).pathname;
    return pathname.includes('/v1/themes/CSS%20Loader/generated/')
      || pathname.includes('/v1/themes/CSS Loader/generated/');
  } catch {
    return false;
  }
};

const targetCssFromLink = (link: HTMLLinkElement) => {
  try {
    const pathname = decodeURIComponent(new URL(link.href).pathname);
    const marker = '/v1/themes/CSS Loader/';
    const index = pathname.indexOf(marker);
    return index >= 0 ? pathname.slice(index + marker.length) : null;
  } catch {
    return null;
  }
};

const patchMatchesDocument = (targetDocument: Document, matchRegex: string) => {
  try {
    return new RegExp(matchRegex).test(targetDocument.title);
  } catch {
    return false;
  }
};

const stylesheetUrl = (targetCss: string, contentHash: string) => {
  const encodedPath = targetCss
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://millennium.host/v1/themes/CSS%20Loader/${encodedPath}?cssloader=${encodeURIComponent(contentHash)}`;
};

const placeOverlayStylesheetLast = (targetDocument: Document, link: HTMLLinkElement) => {
  const parent = targetDocument.head ?? targetDocument.documentElement;
  if (link.parentElement !== parent || parent.lastElementChild !== link) {
    parent.appendChild(link);
  }
};

const syncDocumentStylesheets = (
  targetDocument: Document,
  report: BuildReport,
  contentHash: string,
) => {
  const desiredTargets = new Set(
    (report.patches ?? [])
      .filter((patch) => (
        typeof patch.MatchRegexString === 'string'
        && typeof patch.TargetCss === 'string'
        && patchMatchesDocument(targetDocument, patch.MatchRegexString)
      ))
      .map((patch) => patch.TargetCss as string),
  );

  const existingLinks = Array.from(
    targetDocument.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).filter(isCssLoaderStylesheet);

  existingLinks.forEach((link) => {
    const targetCss = targetCssFromLink(link);
    if (link.dataset.cssLoaderRuntime === 'true' && (!targetCss || !desiredTargets.has(targetCss))) {
      link.remove();
    }
  });

  let synced = 0;
  desiredTargets.forEach((targetCss) => {
    const matchingLinks = existingLinks.filter((link) => targetCssFromLink(link) === targetCss);
    const existing = matchingLinks.find((link) => link.dataset.cssLoaderRuntime !== 'true')
      ?? matchingLinks[0];
    matchingLinks.forEach((link) => {
      if (link !== existing && link.dataset.cssLoaderRuntime === 'true') link.remove();
    });
    const nextHref = stylesheetUrl(targetCss, contentHash);
    if (existing) {
      if (existing.href !== nextHref) existing.href = nextHref;
      placeOverlayStylesheetLast(targetDocument, existing);
    } else {
      const link = targetDocument.createElement('link');
      link.rel = 'stylesheet';
      link.href = nextHref;
      link.dataset.cssLoaderRuntime = 'true';
      placeOverlayStylesheetLast(targetDocument, link);
    }
    synced += 1;
  });

  return synced;
};

const syncCssLoaderStylesheets = (report: BuildReport, contentHash: string) => {
  collectSteamDocuments();
  let synced = 0;

  knownDocuments.forEach((targetDocument) => {
    if (!targetDocument.defaultView || targetDocument.defaultView.closed) {
      knownDocuments.delete(targetDocument);
      return;
    }
    synced += syncDocumentStylesheets(targetDocument, report, contentHash);
  });

  return synced;
};

const browserViewTargetsForTitle = (report: BuildReport, title: string) => (
  (report.patches ?? [])
    .filter((patch) => {
      if (typeof patch.MatchRegexString !== 'string' || typeof patch.TargetCss !== 'string') {
        return false;
      }
      try {
        return new RegExp(patch.MatchRegexString).test(title);
      } catch {
        return false;
      }
    })
    .map((patch) => patch.TargetCss as string)
);

const browserViewSyncExpression = (targetCssFiles: string[], contentHash: string) => {
  const desired = targetCssFiles.map((targetCss) => ({
    targetCss,
    href: stylesheetUrl(targetCss, contentHash),
  }));
  return `(() => {
    const desired = ${JSON.stringify(desired)};
    const targetCssFromLink = (link) => {
      try {
        const pathname = decodeURIComponent(new URL(link.href).pathname);
        const marker = '/v1/themes/CSS Loader/';
        const index = pathname.indexOf(marker);
        return index >= 0 ? pathname.slice(index + marker.length) : null;
      } catch { return null; }
    };
    const desiredTargets = new Set(desired.map((item) => item.targetCss));
    document.querySelectorAll('link[data-css-loader-runtime="browser-view"]').forEach((link) => {
      const targetCss = targetCssFromLink(link);
      if (!targetCss || !desiredTargets.has(targetCss)) link.remove();
    });
    desired.forEach(({ targetCss, href }) => {
      const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .find((link) => targetCssFromLink(link) === targetCss);
      if (existing) {
        if (existing.href !== href) existing.href = href;
        const parent = document.head || document.documentElement;
        if (existing.parentElement !== parent || parent.lastElementChild !== existing) {
          parent.appendChild(existing);
        }
      } else {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.cssLoaderRuntime = 'browser-view';
        (document.head || document.documentElement).appendChild(link);
      }
    });
    return desired.length;
  })()`;
};

const syncBrowserViewStylesheets = async (report: BuildReport, contentHash: string) => {
  const response = await ChromeDevToolsProtocol.send('Target.getTargets') as {
    targetInfos?: TargetInfo[];
  };
  const targetInfos = response?.targetInfos ?? [];
  const liveTargetIds = new Set(targetInfos.map((target) => target.targetId).filter(Boolean));

  browserViewSessions.forEach((_sessionId, targetId) => {
    if (!liveTargetIds.has(targetId)) browserViewSessions.delete(targetId);
  });

  for (const target of targetInfos) {
    const targetId = target.targetId;
    const title = target.title ?? '';
    if (!targetId || target.type !== 'page') continue;
    if (!/^(QuickAccess|MainMenu|notificationtoasts)/.test(title)) continue;

    const targetCssFiles = browserViewTargetsForTitle(report, title);
    if (targetCssFiles.length === 0) continue;

    try {
      let sessionId = browserViewSessions.get(targetId);
      if (!sessionId) {
        const attached = await ChromeDevToolsProtocol.send('Target.attachToTarget', {
          targetId,
          flatten: true,
        }) as { sessionId?: string };
        sessionId = attached?.sessionId;
        if (!sessionId) continue;
        browserViewSessions.set(targetId, sessionId);
      }

      await ChromeDevToolsProtocol.send(
        'Runtime.evaluate',
        {
          expression: browserViewSyncExpression(targetCssFiles, contentHash),
          returnByValue: true,
        },
        sessionId,
      );
    } catch {
      browserViewSessions.delete(targetId);
    }
  }
};

const handleWindowCreated = (popup: any) => {
  const popupDocument = popup?.m_popup?.document as Document | undefined;
  liveDocument(popupDocument);
  if (popupDocument && currentReport && currentContentHash) {
    window.setTimeout(() => {
      if (currentReport && currentContentHash) {
        syncDocumentStylesheets(popupDocument, currentReport, currentContentHash);
      }
    }, 0);
  }
};

if (Millennium.AddWindowCreateHook) {
  Millennium.AddWindowCreateHook(handleWindowCreated);
}

const checkForThemeChange = async () => {
  if (checkInProgress) return;
  checkInProgress = true;

  try {
    const revision = await getCssLoaderRevision();
    if (!revision || typeof revision !== 'string') return;
    const report = parseBuildReport(revision);
    if (!report?.contentHash) return;
    currentReport = report;

    if (currentContentHash === undefined) {
      currentContentHash = report.contentHash;
      syncCssLoaderStylesheets(report, report.contentHash);
      await syncBrowserViewStylesheets(report, report.contentHash);
      return;
    }

    if (report.contentHash === currentContentHash) {
      // Popup documents can be created after the report was first read. The
      // regular sync makes sure Quick Access, Main Menu, and notifications
      // receive their matching bundle even when Millennium did not attach a
      // theme link to those BrowserView documents itself.
      syncCssLoaderStylesheets(report, report.contentHash);
      await syncBrowserViewStylesheets(report, report.contentHash);
      return;
    }

    currentContentHash = report.contentHash;
    syncCssLoaderStylesheets(report, report.contentHash);
    await syncBrowserViewStylesheets(report, report.contentHash);
  } finally {
    checkInProgress = false;
  }
};

const startRuntimeWatcher = () => {
  void checkForThemeChange();
  if (runtimeTimer === undefined) {
    runtimeTimer = window.setInterval(() => void checkForThemeChange(), POLL_INTERVAL_MS);
  }
};

const stopRuntimeWatcher = () => {
  if (runtimeTimer !== undefined) {
    window.clearInterval(runtimeTimer);
    runtimeTimer = undefined;
  }
  currentContentHash = undefined;
  currentReport = null;
  knownDocuments.clear();
  browserViewSessions.clear();
};

const RuntimeStatus = () => {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getCssLoaderRevision().then((revision) => {
      if (mounted) setConnected(typeof revision === 'string' && revision.length > 0);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <PanelSection title="Runtime">
      <PanelSectionRow>
        CSS Loader Desktop backend: {connected ? 'Connected' : 'Waiting'}
      </PanelSectionRow>
      <PanelSectionRow>
        Mode: Overlay (your selected Millennium theme stays active)
      </PanelSectionRow>
      <PanelSectionRow>
        CSS Loader styles update live across Steam and its isolated side-menu views.
      </PanelSectionRow>
    </PanelSection>
  );
};

startRuntimeWatcher();

export default definePlugin(() => ({
  title: 'CSS Loader Runtime',
  icon: <IconsModule.Settings />,
  content: <RuntimeStatus />,
  onDismount() {
    stopRuntimeWatcher();
  },
}));
