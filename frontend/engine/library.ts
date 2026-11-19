// The theme engine lives in the Lua backend (backend/engine). After anything
// that changes it, the styles are fetched and handed to the windows.
import { hub, Style } from '../delivery/hub';
import { fromBackendJson } from './files';

type StylesPage = { revision: number; pages: number; styles: Style[] };

let seen = -1;
let fetching: Promise<void> | null = null;
let again = false;

async function fetchStyles(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const first = fromBackendJson<StylesPage>(await backend.get_styles(0));
    const styles = [...first.styles];
    let moved = false;
    for (let page = 1; page < first.pages; page++) {
      const next = fromBackendJson<StylesPage>(await backend.get_styles(page));
      if (next.revision !== first.revision) {
        moved = true;
        break;
      }
      styles.push(...next.styles);
    }
    if (moved) continue;
    if (first.revision !== seen || !hub.isReady()) {
      seen = first.revision;
      hub.setStyles(styles);
    }
    return;
  }
}

// One fetch at a time; a request during a fetch runs once more after it, so the
// last change always arrives.
export function refreshStyles(): Promise<void> {
  if (fetching) {
    again = true;
    return fetching;
  }
  fetching = (async () => {
    try {
      do {
        again = false;
        await fetchStyles();
      } while (again);
    } finally {
      fetching = null;
    }
  })();
  return fetching;
}

// A backend call that changes the library.
export async function changing<T>(call: Promise<T>): Promise<T> {
  const result = await call;
  await refreshStyles();
  return result;
}
