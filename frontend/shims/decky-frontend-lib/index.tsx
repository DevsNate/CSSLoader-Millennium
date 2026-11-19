// Upstream imports decky-frontend-lib 3; Millennium's SDK carries the same
// library. Only what differs is defined here.
import {
  SidebarNavigation as SteamSidebarNavigation,
  Navigation as SteamNavigation,
  classMapList,
  findModuleExport,
  getGamepadNavigationTrees as steamNavigationTrees,
  gamepadDialogClasses as steamDialogClasses,
  gamepadSliderClasses as steamSliderClasses,
  showModal as steamShowModal,
} from 'millennium';
import { useContext } from 'react';
import type { ComponentProps, ComponentType, ReactElement, ReactNode } from 'react';
import { BigPictureModal } from '../../desktop-window/big-picture-presentation';
import { DesktopPathContext, desktopNavigate, desktopNavigateBack, isDesktopPage } from '../../desktop-window/routes';
import { getPageOwnerWindow } from '../../desktop-window/window-boundary';
import type { ServerAPI } from '../server';

export {
  ButtonItem,
  ColorPickerModal,
  ConfirmModal,
  DialogButton,
  DialogCheckbox,
  Dropdown,
  DropdownItem,
  Focusable,
  ModalRoot,
  PanelSection,
  PanelSectionRow,
  ScrollPanelGroup,
  SliderField,
  TextField,
  Toggle,
  ToggleField,
  findModuleChild,
  getGamepadNavigationTrees,
  replacePatch,
  staticClasses,
} from 'millennium';
export type { DropdownOption, Module, Patch, SingleDropdownOption } from 'millennium';
export type { ServerAPI } from '../server';
export { Tabs } from './tabs';

// decky-frontend-lib 3 typed these loosely; upstream reads names the SDK's types don't list.
// The SDK's classMap merges every module; decky-frontend-lib's is this list.
export const classMap = classMapList as unknown as Record<string, string>[];
export const gamepadDialogClasses = steamDialogClasses as Record<string, string>;
export const gamepadSliderClasses = steamSliderClasses as Record<string, string>;

// DonatePage imports it without using it; decky-frontend-lib's is commented out too.
export const Panel = ({ children }: { children?: ReactNode }) => <div>{children}</div>;

// Upstream's default export is definePlugin(serverApi => plugin); the entry
// (frontend/index.tsx) calls it with the shim.
export const definePlugin = <T,>(factory: (serverApi: ServerAPI) => T) => factory;

// Desktop mode has no /cssloader routes to go to: they open in our window.
export const Navigation: typeof SteamNavigation = new Proxy(SteamNavigation, {
  get(target, property, receiver) {
    if (property === 'Navigate') {
      return (path: string) => (desktopNavigate(path) ? undefined : target.Navigate(path));
    }
    if (property === 'NavigateBack') {
      return () => (desktopNavigateBack() ? undefined : target.NavigateBack());
    }
    return Reflect.get(target, property, receiver);
  },
});

// Steam's sidebar keeps its tab in the main window's router (history.replace),
// which in desktop mode took over Steam's window behind ours. In our window,
// Steam's paged settings view, which the sidebar wraps, is used directly, and
// tabs go through our window's history, so Esc steps back through them.
type SidebarProps = ComponentProps<typeof SteamSidebarNavigation>;
type SidebarPage = Exclude<SidebarProps['pages'][number], 'separator'>;
type PagedSettingsProps = {
  pages: SidebarProps['pages'];
  page?: string;
  onPageRequested: (identifier: string) => void;
  showTitle?: boolean;
  title?: ReactNode;
};

let pagedSettings: ComponentType<PagedSettingsProps> | undefined;
const getPagedSettings = () => pagedSettings ??= findModuleExport((exported: unknown) =>
  typeof exported === 'function' && Function.prototype.toString.call(exported).includes('"PagedSettings"'),
) as ComponentType<PagedSettingsProps> | undefined;

export const SidebarNavigation = (props: SidebarProps) => {
  const path = useContext(DesktopPathContext);
  const PagedSettings = path === null ? undefined : getPagedSettings();
  if (path === null || !PagedSettings) return <SteamSidebarNavigation {...props} />;
  const routeOf = new Map<string, string | undefined>();
  const tabs: SidebarPage[] = [];
  const pages = props.pages.map((page): SidebarProps['pages'][number] => {
    if (page === 'separator') return page;
    const identifier = page.identifier ?? page.route ?? String(page.title);
    routeOf.set(identifier, page.route);
    const tab: SidebarPage = { ...page, route: undefined, identifier };
    tabs.push(tab);
    return tab;
  });
  const current = tabs.find((page) => page.identifier === path) ?? tabs.find((page) => page.visible !== false);
  return (
    <PagedSettings
      title={props.title}
      showTitle={props.showTitle}
      pages={pages}
      page={current?.identifier}
      onPageRequested={(identifier: string) => {
        const route = routeOf.get(identifier);
        if (route && identifier !== current?.identifier) desktopNavigate(route);
        props.onPageRequested?.(identifier);
      }}
    />
  );
};

// Where a modal goes when the caller names no window, as upstream's always do.
// Millennium's own default (findSP) looks for Big Picture's root by its old
// name, root_1_, and throws on current Steam, which calls it GamepadUI_Full_Root.
const defaultModalParent = (): Window | undefined => {
  try {
    const trees: any[] = steamNavigationTrees() ?? [];
    const root = trees.find((tree) => tree?.m_ID === 'GamepadUI_Full_Root') ?? trees.find((tree) => tree?.m_ID === 'root_1_');
    const view = root?.Root?.Element?.ownerDocument?.defaultView as Window | undefined;
    if (view && !view.closed) return view;
  } catch {}
  // The desktop client: the Steam window that has focus.
  try {
    for (const popup of (globalThis as any).g_PopupManager?.GetPopups?.() ?? []) {
      const view = popup?.m_popup?.window ?? popup?.m_popup;
      if (view && !view.closed && view.document?.hasFocus()) return view as Window;
    }
  } catch {}
  return undefined;
};

export const showModal: typeof steamShowModal = (modal, parent, props) => {
  parent ??= defaultModalParent();
  const owner = getPageOwnerWindow(parent) ?? parent;
  const ownerWindow = owner as Window | undefined;
  if (!ownerWindow || !isDesktopPage(ownerWindow) || props?.bForcePopOut) return steamShowModal(modal, parent, props);
  const wrap = (content: typeof modal) => {
    const element = content as ReactElement<{ closeModal?: () => void }>;
    return <BigPictureModal modal={element} closeModal={element.props.closeModal} />;
  };
  const result = steamShowModal(wrap(modal), ownerWindow, { ...props, strTitle: undefined, bNeverPopOut: true });
  return { ...result, Close: () => result.Close(), Update: (content) => result.Update(wrap(content)) };
};
