// css_translations.json: Steam's class names change between versions, and
// api.deckthemes.com publishes the map. Ported from upstream main.py
// fetch_class_mappings, which retries every minute until one fetch works.
// Downloaded here, so the backend never waits on the network; the backend
// saves it and reloads its themes when the map changed.
import { environment } from './environment';
import { refreshStyles } from './library';
import { storeRead } from '../settings';

const RETRY_MS = 60_000;
const TIMEOUT_MS = 30_000;
const STORE_ORIGIN = 'https://api.deckthemes.com';

const wantsBeta = () => {
  const setting = storeRead('beta_translations').trim();
  if (setting === '' || setting === '-1' || setting === 'auto') return environment.steamBeta;
  return setting === '1' || setting === 'true';
};

// True when the fetch itself worked.
export async function fetchClassMappings(): Promise<boolean> {
  const url = `${STORE_ORIGIN}${wantsBeta() ? '/beta.json' : '/stable.json'}`;
  let text: string;
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    text = await response.text();
  } catch (error) {
    console.warn(`[CSS Loader] Could not fetch class translations from ${url}:`, error);
    return false;
  }
  const result = await backend.save_translations(text);
  if (!result.success) {
    console.warn('[CSS Loader] Could not save class translations:', result.error);
    return false;
  }
  if (result.changed) await refreshStyles();
  return true;
}

export function startClassMappingFetch() {
  const attempt = async () => {
    const done = await fetchClassMappings().catch(() => false);
    if (!done) setTimeout(attempt, RETRY_MS);
  };
  void attempt();
}
