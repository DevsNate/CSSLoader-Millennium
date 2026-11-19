// Tab matching (with names resolved by the backend), zip reading, and how the
// style list reaches a window: order, scope, startup styles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { createLoader } from './lib/load-ts.mjs';
import { createBackend } from './lib/lua-backend.mjs';

globalThis.backend = {};
globalThis.__cssLoaderBoot = undefined;

const load = createLoader({ millennium: {}, react: {}, 'react/jsx-runtime': {} });
const { compareTab } = load('frontend/delivery/tabs.ts');
const { hub, reconcileStyles } = load('frontend/delivery/hub.ts');
const { readZip, toBase64, fromBase64 } = load('frontend/engine/zip.ts');

const lua = createBackend().start();
lua.run(`tabs = require('engine.tabs')`);
const extendTabs = (tabs, mappings = {}) => {
  lua.run(`__tabs = require('engine.pyjson').decode(${JSON.stringify(JSON.stringify(tabs))}); __map = require('engine.pyjson').decode(${JSON.stringify(JSON.stringify(mappings))})`);
  return lua.json(`require('engine.pyjson').array(tabs.extend(__tabs, __map))`);
};

// --- Tabs -------------------------------------------------------------------
const context = (title, url = 'about:blank', classes = []) => ({ title, url, classes });
const matches = (tabs, ctx) => extendTabs(tabs).some((tab) => compareTab(tab, ctx));
assert.ok(matches(['desktop'], context('Steam')), 'desktop matches the main window');
assert.ok(matches(['desktop'], context('SteamLibraryWindow')));
assert.ok(!matches(['desktop'], context('Steam Root Menu')), 'a title regex covers the whole title');
assert.ok(matches(['desktopcontextmenu'], context('Steam Root Menu')));
assert.ok(matches(['desktopcontextmenu'], context('Store Supernav')));
assert.ok(matches(['desktopchat'], context('Friends', 'about:blank', ['friendsui-container'])));
assert.ok(matches(['bigpicture'], context('x', 'about:blank?useragent=Valve%20Steam%20Gamepad/default')));
assert.ok(matches(['SP'], context('x', 'about:blank?useragent=Valve%20Steam%20Gamepad')), 'legacy SP');
assert.ok(matches(['store'], context('x', 'https://store.steampowered.com/app/10')));
assert.ok(matches(['QuickAccess'], context('QuickAccess_uid2')), 'legacy name, as extended by upstream');
assert.ok(!compareTab('(', context('(')), 'a broken regex never matches');
assert.throws(() => extendTabs(['a'], { a: ['b'], b: ['a'] }), /loop/, 'cyclic mappings stop');
assert.ok(extendTabs(['bigpictureoverlay']).includes('QuickAccess.*') || extendTabs(['bigpictureoverlay']).length > 0);

// The startup file's matcher (backend/engine/output.lua) must agree with compareTab.
const output = readFileSync(new URL('../../backend/engine/output.lua', import.meta.url), 'utf8');
const matcher = /function m\(t,u,c,s\)\{[\s\S]*?catch\(e\)\{return false\}\}/.exec([...output.matchAll(/\[\[([\s\S]*?)\]\]/g)].map((match) => match[1]).join(''))?.[0];
assert.ok(matcher, 'the startup matcher must be findable');
const served = new Function(`${matcher}; return m;`)();
for (const [tab, ctx] of [
  ['~store~', context('', 'https://store.x')], ['~store~', context('', 'https://other')],
  ['!a', context('', '', ['a'])], ['!a', context('', '', ['b'])],
  ['Steam|X', context('Steam')], ['Steam', context('Steam Root')], ['(', context('(')], ['.*Menu', context('A Menu')],
  ['~~', context('~~')],
]) {
  assert.equal(served(ctx.title, ctx.url, ctx.classes, tab), compareTab(tab, ctx), `served matcher differs on ${tab}`);
}

// --- Style list -------------------------------------------------------------
const style = (id, tabs, scope = 'all') => ({ id, css: `/*${id}*/`, tabs, scope });
const syncs = [];
const target = {
  context: () => context('Steam'),
  sync(items, rebuild) { syncs.push({ css: items.map((item) => item.css), ids: items.map((item) => item.id), rebuild }); },
};
hub.register(target);
assert.deepEqual(syncs.at(-1).css, [], 'no startup styles, no list: nothing yet');

// The hook defines the startup styles the first time it runs.
globalThis.__cssLoaderBoot = { d: [
  { i: 'a', t: ['Steam'], c: '/*a*/', s: 'all' },
  { i: 'pad', t: ['Steam'], c: '/*pad*/', s: 'gamepad' },
  { i: 'bad', t: 'Steam', c: 1, s: 'all' },
] };
hub.syncTarget(target);
assert.deepEqual(syncs.at(-1), { css: ['/*a*/'], ids: ['a'], rebuild: false }, 'startup styles, by the look of the window');

hub.setStyles([style('a', ['Steam']), style('b', ['Steam']), style('other', ['Menu']), style('pad', ['Steam'], 'gamepad')]);
assert.deepEqual(syncs.at(-1), { css: ['/*a*/', '/*b*/'], ids: ['a', 'b'], rebuild: false }, 'the backend\'s list replaces them, keeping ids that are the same');
assert.equal(hub.isReady(), true);
hub.setUiMode('gamepad');
assert.deepEqual(syncs.at(-1).css, ['/*a*/', '/*b*/', '/*pad*/'], 'scope follows the UI mode');
hub.setUiMode('desktop');
assert.deepEqual(syncs.at(-1).css, ['/*a*/', '/*b*/']);
hub.setStyles([style('b', ['Steam']), style('a2', ['Steam'])]);
assert.deepEqual(syncs.at(-1).ids, ['b', 'a2'], 'order comes from the backend');

// reconcile keeps existing elements, appends new ones, removes stale ones.
class El {
  constructor() { this.classList = { add: (name) => { this.cls = name; } }; this.parent = null; }
  remove() { this.parent.kids.splice(this.parent.kids.indexOf(this), 1); }
}
const head = { kids: [], append(el) { el.parent = head; head.kids.push(el); } };
const doc = {
  head,
  querySelectorAll: () => [...head.kids],
  createElement: () => new El(),
};
reconcileStyles(doc, [{ id: '1', css: 'x' }, { id: '2', css: 'y' }], false);
const keep = head.kids[0];
reconcileStyles(doc, [{ id: '1', css: 'x' }, { id: '3', css: 'z' }], false);
assert.equal(head.kids[0], keep, 'an unchanged style is not touched');
assert.deepEqual(head.kids.map((el) => el.id), ['1', '3']);
reconcileStyles(doc, [{ id: '1', css: 'x' }], true);
assert.notEqual(head.kids[0], keep, 'a rebuild replaces everything');

// --- Zip --------------------------------------------------------------------
const zip = (files) => {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, text, deflate] of files) {
    const raw = encoder.encode(text);
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBytes = encoder.encode(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, centralBytes, end]));
};
const entries = readZip(zip([['T/', '', false], ['T/theme.json', '{"name":"T"}', true], ['T/a.css', 'a{}', false]]));
assert.deepEqual(entries.map((entry) => entry.name), ['T/theme.json', 'T/a.css'], 'folders are skipped');
assert.equal(new TextDecoder().decode(await entries[0].bytes()), '{"name":"T"}', 'deflate');
assert.equal(new TextDecoder().decode(await entries[1].bytes()), 'a{}', 'stored');
assert.throws(() => readZip(new Uint8Array(40)), /Not a zip/);
const bytes = new Uint8Array(100000).map((_, index) => index % 251);
assert.deepEqual(fromBase64(toBase64(bytes)), bytes, 'base64 round trip');

console.log('Delivery check passed: tabs, startup matcher, style list, zip.');
process.exit(0);
