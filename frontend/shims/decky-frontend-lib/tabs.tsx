// Millennium: the SDK's Tabs waits for window.DeckyPluginLoader, which only exists
// when Decky runs, and shows a spinner forever without it. Steam's own component
// is found through the tab header that shares its module instead.
import { DialogButton, Focusable, findModuleByExport } from 'millennium';
import { createElement, useState, type FC, type ReactNode } from 'react';

interface Tab {
  id: string;
  title: string;
  content: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onShowTab: (tab: string) => void;
  autoFocusContents?: boolean;
}

const isTabHeader = (value: unknown) => {
  if (typeof value !== 'function') return false;
  const source = Function.prototype.toString.call(value);
  return source.includes('onShowTab') && source.includes('showGlyphs');
};

const REACT_MEMO = Symbol.for('react.memo');

let steamTabs: FC<TabsProps> | null | undefined;

function findSteamTabs() {
  if (steamTabs !== undefined) return steamTabs;
  try {
    const module = findModuleByExport((value: unknown) => isTabHeader(value));
    const found = module && Object.values(module).find((value: any) => value?.$$typeof === REACT_MEMO);
    steamTabs = (found as FC<TabsProps> | undefined) ?? null;
  } catch (error) {
    console.error('[CSS Loader] Could not find the tabs component', error);
    steamTabs = null;
  }
  if (!steamTabs) console.warn('[CSS Loader] Using the plain tab row.');
  return steamTabs;
}

// Keeps the store usable if a Steam update moves the component.
const PlainTabs: FC<TabsProps> = ({ tabs, activeTab, onShowTab }) => {
  const [fallback] = useState(tabs[0]?.id);
  const current = tabs.find((tab) => tab.id === activeTab) ?? tabs.find((tab) => tab.id === fallback);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Focusable style={{ display: 'flex', gap: '0.5em', padding: '0.5em 2.8vw' }}>
        {tabs.map((tab) => (
          <DialogButton
            key={tab.id}
            style={{ width: 'auto', opacity: tab === current ? 1 : 0.6 }}
            onClick={() => onShowTab(tab.id)}
          >
            {tab.title}
          </DialogButton>
        ))}
      </Focusable>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 2.8vw' }}>{current?.content}</div>
    </div>
  );
};

export const Tabs: FC<TabsProps> = (props) => createElement(findSteamTabs() ?? PlainTabs, props);
