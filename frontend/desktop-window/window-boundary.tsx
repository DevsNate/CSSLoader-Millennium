// A page in our desktop window: upstream's pages are Big Picture pages, so the
// window carries Big Picture's root classes, controls and focus navigation.
// Adapted from SteamGridDB-Millennium.
import { useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { BigPicturePresentation, bigPictureRootClasses } from './big-picture-presentation';
import { DesktopNavigation } from './navigation';
import { isolateFromTheme } from './theme-isolation';
import { dropDesktopUIClass } from './ui-class';

const pageWindows = new Set<Window>();

export const getPageOwnerWindow = (parent?: EventTarget): Window | null => {
  if (parent && parent !== window) {
    const candidate = parent as { ownerDocument?: Document; document?: Document };
    const owner = candidate.ownerDocument?.defaultView ?? candidate.document?.defaultView;
    if (owner && !owner.closed) return owner;
  }
  for (const owner of pageWindows) {
    if (owner.closed) pageWindows.delete(owner);
    else if (owner.document.hasFocus()) return owner;
  }
  return null;
};

const pageStyles = `
html:has(.cssLoaderDesktopPage), body:has(.cssLoaderDesktopPage) {
  height: 100% !important;
  overflow: hidden !important;
}
body:has(.cssLoaderDesktopPage) .PopupFullWindow { height: 100% !important; }
body:has(.cssLoaderDesktopPage) .TitleBar {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  z-index: 10 !important;
  background: transparent !important;
  pointer-events: none !important;
}
body:has(.cssLoaderDesktopPage) .TitleBar .window-controls { pointer-events: auto !important; }
.cssLoaderDesktopPage {
  position: relative !important;
  box-sizing: border-box !important;
  width: 100% !important;
  height: 100% !important;
  overflow: hidden !important;
  color: #fff !important;
  background: #0e141b !important;
  --gamepadui-current-footer-height: 0px !important;
}
.cssLoaderDesktopPage .TabHeaderRowWrapper { -webkit-app-region: drag !important; }
/* The title bar's drag area lies over the top of the page, and the system
   takes clicks in a drag area before the page sees them: controls opt out. */
.cssLoaderDesktopPage :is([role="tab"], button, a, input, select, textarea, .Focusable) { -webkit-app-region: no-drag !important; }
`;

export const PageWindowBoundary = ({ pageClass, onWindow, onCancel, children }: {
  pageClass: string;
  onWindow: (owner: Window) => void;
  // Esc or B; without it, they close the window.
  onCancel?: () => void;
  children: ReactNode;
}) => {
  const release = useRef<(() => void) | undefined>(undefined);
  const attach = useCallback((node: HTMLDivElement | null) => {
    release.current?.();
    release.current = undefined;
    const owner = node?.ownerDocument.defaultView;
    if (!node || !owner) return;
    pageWindows.add(owner);
    onWindow(owner);
    const restoreTheme = isolateFromTheme(node.ownerDocument);
    const restoreUi = dropDesktopUIClass(node.ownerDocument);
    release.current = () => {
      restoreUi();
      restoreTheme();
      pageWindows.delete(owner);
    };
  }, [onWindow]);

  return (
    <div ref={attach} className={`${pageClass} ${bigPictureRootClasses}`}>
      <style>{pageStyles}</style>
      <DesktopNavigation onCancel={onCancel}><BigPicturePresentation>{children}</BigPicturePresentation></DesktopNavigation>
    </div>
  );
};
