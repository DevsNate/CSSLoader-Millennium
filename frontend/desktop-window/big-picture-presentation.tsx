// Big Picture's controls and dialogs in a desktop window. From
// SteamGridDB-Millennium.
import { findModuleExport } from 'millennium';
import { cloneElement } from 'react';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { DesktopNavigation } from './navigation';

// Big Picture's root carries these, and much of sp.css (inputs, fields, scrollbars)
// is scoped under them. Desktop windows don't have that root.
export const bigPictureRootClasses = 'BasicUI GamepadMode';

const dialogStyles = `
body:has(.cssLoaderDesktopDialog) .ModalOverlayBackground {
  background: rgba(0, 0, 0, .85) !important;
  backdrop-filter: blur(3px) !important;
}
.cssLoaderDesktopDialog > .ModalPosition {
  height: auto !important;
  flex-direction: row !important;
  align-content: normal !important;
}
.cssLoaderDesktopDialog { display: contents !important; color: #fff !important; }
`;

let nativeProvider: ComponentType<{ children?: ReactNode }> | undefined;

export const BigPicturePresentation = ({ children }: { children?: ReactNode }) => {
  nativeProvider ??= findModuleExport((exported: unknown) => {
    if (typeof exported !== 'function') return false;
    const source = Function.prototype.toString.call(exported);
    return source.includes('.Provider') && source.includes('strButtonClassName:')
      && source.includes('SliderField:') && source.includes('ToggleField:');
  }) as typeof nativeProvider;

  if (!nativeProvider) {
    return <div role="alert">CSS Loader could not load Steam's Big Picture controls. Reopen this window after Steam finishes loading.</div>;
  }
  const Provider = nativeProvider;
  return <Provider>{children}</Provider>;
};

let modalPositionProvider: ComponentType<{ children?: ReactNode }> | null | undefined;

// Steam's desktop ModalPosition refocuses itself on every render, which closes
// dropdown menus as soon as they open; Big Picture's comes through a context.
const findModalPositionProvider = () => {
  modalPositionProvider ??= (findModuleExport((exported: unknown) => (
    typeof exported === 'function'
    && Function.prototype.toString.call(exported).includes('Provider,{value:{ModalPosition:')
  )) as typeof modalPositionProvider) ?? null;
  return modalPositionProvider;
};

export const BigPictureModal = ({ modal, closeModal }: {
  modal: ReactElement<{ closeModal?: () => void }>;
  closeModal?: () => void;
}) => {
  const ModalPositionProvider = findModalPositionProvider();
  const content = (
    <div className={`cssLoaderDesktopDialog ${bigPictureRootClasses}`}>
      {cloneElement(modal, { closeModal })}
    </div>
  );
  return (
    <DesktopNavigation modal><BigPicturePresentation>
      <style>{dialogStyles}</style>
      {ModalPositionProvider ? <ModalPositionProvider>{content}</ModalPositionProvider> : content}
    </BigPicturePresentation></DesktopNavigation>
  );
};
