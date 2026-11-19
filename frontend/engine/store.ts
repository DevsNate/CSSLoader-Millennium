// Installing a theme from DeckThemes. Ported from DeckThemes/SDH-CssLoader
// css_remoteinstall.py; Lua downloads the zip, this unpacks it, and each file
// goes back through a validated backend call.
import { environment } from './environment';
import { expectWrite } from './files';
import { storeFlag } from '../settings';
import { fromBase64, readZip, toBase64 } from './zip';

export type Result = { success: boolean; message?: string };

type ThemeRecord = {
  id: string;
  manifestVersion: number;
  download: { id: string };
  dependencies?: { id: string; name: string }[];
  target?: string;
  targets?: string[];
};

async function downloadZip(blobId: string): Promise<Uint8Array> {
  const held = await backend.download_blob(blobId);
  if (!held.success || !held.id) throw new Error(held.error || 'The theme could not be downloaded.');
  try {
    const parts: Uint8Array[] = [];
    for (let index = 0; index < (held.chunks ?? 0); index++) {
      const chunk = await backend.read_blob_chunk(held.id, index);
      if (typeof chunk !== 'string') throw new Error('The downloaded theme could not be read.');
      parts.push(fromBase64(chunk));
    }
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  } finally {
    void backend.release_blob(held.id);
  }
}

export async function installTheme(id: string, localThemes: string[]): Promise<Result> {
  let record: ThemeRecord;
  try {
    const reply = await backend.store_request('GET', `/themes/${encodeURIComponent(id)}`, '', '');
    if (!reply.success || reply.status !== 200) throw new Error(reply.error || `Invalid status code ${reply.status}`);
    record = JSON.parse(reply.body ?? '');
  } catch (error) {
    return { success: false, message: String((error as Error)?.message ?? error) };
  }
  if (record.manifestVersion > environment.cssLoaderVersion) {
    throw new Error('Manifest version of themedb entry is unsupported by this version of CSS_Loader');
  }
  try {
    const entries = readZip(await downloadZip(record.download.id));
    for (const entry of entries) {
      await expectWrite(backend.write_theme_file(entry.name, toBase64(await entry.bytes())));
    }
  } catch (error) {
    return { success: false, message: String((error as Error)?.message ?? error) };
  }
  await backend.remember_catalog_record(JSON.stringify(record)).catch(() => undefined);

  if (!storeFlag('no_deps_install', environment.flags)) {
    for (const dependency of record.dependencies ?? []) {
      if (localThemes.includes(dependency.name)) continue;
      await installTheme(dependency.id, localThemes);
    }
  }
  return { success: true };
}
