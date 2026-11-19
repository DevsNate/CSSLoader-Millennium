// Live CSS editing. Upstream used a file system watcher; this polls file times.
import { changing } from './library';
import { storeWrite } from '../settings';

const POLL_MS = 2000;

let timer: ReturnType<typeof setInterval> | undefined;
let lastModified = 0;
let polling = false;

export const isWatching = () => timer !== undefined;

const poll = async () => {
  if (polling) return;
  polling = true;
  try {
    const modified = await backend.themes_modified();
    if (modified !== lastModified) {
      lastModified = modified;
      await changing(backend.reset());
    }
  } catch (error) {
    console.warn('[CSS Loader] Could not check the themes folder', error);
  } finally {
    polling = false;
  }
};

export async function setWatching(enable: boolean, onlyThisSession = false) {
  if (enable === isWatching()) return { success: false, message: 'Nothing to do!' };
  if (enable) {
    lastModified = await backend.themes_modified();
    timer = setInterval(poll, POLL_MS);
  } else {
    clearInterval(timer);
    timer = undefined;
  }
  if (!onlyThisSession) await storeWrite('watch', enable ? '1' : '0');
  return { success: true, message: 'Success' };
}
