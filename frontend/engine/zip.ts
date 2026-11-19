// Reads a zip's central directory and inflates entries with Chromium's
// DecompressionStream, so no zip library is needed in Lua or here.
export type ZipEntry = { name: string; bytes(): Promise<Uint8Array> };

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const decoder = new TextDecoder();

export function readZip(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let index = data.length - 22; index >= 0 && index >= data.length - 22 - 0xffff; index--) {
    if (view.getUint32(index, true) === END_SIGNATURE) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip file.');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) throw new Error('The zip file is damaged.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error('Encrypted zip files are not supported.');
    if (method !== 0 && method !== 8) throw new Error(`Unsupported compression in ${name}.`);
    entries.push({
      name,
      async bytes() {
        if (view.getUint32(local, true) !== LOCAL_SIGNATURE) throw new Error('The zip file is damaged.');
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const raw = data.subarray(start, start + compressed);
        if (method === 0) return raw;
        const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      },
    });
  }
  return entries;
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
