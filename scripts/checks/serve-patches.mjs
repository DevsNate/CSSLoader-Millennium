// Applies backend/main.lua's patch to the installed Steam client's sp.js the way
// Millennium's loopback engine does, together with SteamGridDB's on the same
// spot if that repo is next to this one, and runs the patched CreatePopup tail.
// Set STEAM_PATH if Steam isn't in the default folder.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from './lib/lua-backend.mjs';

const steam = process.env.STEAM_PATH ?? 'C:/Program Files (x86)/Steam';
const spPath = join(steam, 'steamui/sp.js');
if (!existsSync(spPath)) {
  console.log(`Serve patch check skipped: no ${spPath}.`);
  process.exit(0);
}

// What a backend's patches look like to Millennium.
const luaPatches = (file) => {
  const backend = createBackend().start(readFileSync(file, 'utf8'));
  backend.run(`
local out = {}
for _, p in ipairs(plugin.patches) do
  local t = {}
  for _, x in ipairs(p.transforms) do t[#t+1] = {x.match, x.replace} end
  out[#out+1] = {p.file, p.find, t}
end
__patches = out`);
  // Strings and nested lists, without a JSON object in between.
  const read = (path) => {
    if (backend.evaluate(`type(${path})`) === 'string') return backend.evaluate(path);
    const list = [];
    const length = Number(backend.evaluate(`#${path}`));
    for (let index = 1; index <= length; index++) list.push(read(`${path}[${index}]`));
    return list;
  };
  return read('__patches');
};

// Millennium's expand_self and re2_to_rust_rep; JS replacement strings share Rust's `$N` and `$$`.
const replacement = (text, id) => text
  .replaceAll('#{{self}}', `window.PLUGIN_LIST['${id}']`)
  .replace(/\$|\\(\d)/g, (match, digit) => (digit ? `$${digit}` : '$$'));

const apply = (code, patches, id) => {
  for (const [file, find, transforms] of patches) {
    if (!new RegExp(file).test('https://steamloopback.host/sp.js')) continue;
    const found = new RegExp(find).exec(code);
    assert.ok(found, `find must match sp.js: ${find}`);
    let region = found[0];
    for (const [match, replace] of transforms) {
      assert.ok(new RegExp(match).test(region), `transform must match: ${match}`);
      region = region.replace(new RegExp(match, 'g'), replacement(replace, id));
    }
    code = code.slice(0, found.index) + region + code.slice(found.index + found[0].length);
  }
  return code;
};

const original = readFileSync(spPath, 'utf8');
const own = fileURLToPath(new URL('../../backend/main.lua', import.meta.url));
const patches = luaPatches(own);
assert.equal(patches.length, 1);
// Millennium v3.6.2 stops Steam from starting if the whole patch list outgrows
// a pipe of about 4 KB, so this has to stay small and fixed.
const patchBytes = patches[0][0].length + patches[0][1].length + patches[0][2].flat().join('').length;
assert.ok(patchBytes < 500, `the patch must stay small: ${patchBytes} bytes`);
assert.equal([...original.matchAll(new RegExp(patches[0][1], 'g'))].length, 1, 'find must match once');

let patched = apply(original, patches, 'css-loader');
assert.ok(!/\$\d|\\\d/.test(patches[0][2].flat().join('').replace(/\\1/g, '')), 'no stray group references');
// Plugins are applied by name, so css-loader comes before steamgriddb.
const sgdb = fileURLToPath(new URL('../../../SteamGridDB-Millennium/backend/main.lua', import.meta.url));
let coexists = false;
if (existsSync(sgdb)) {
  const theirs = luaPatches(sgdb).filter(([, , transforms]) => transforms.some(([match]) => match.includes('popup')));
  patched = apply(patched, theirs, 'steamgriddb');
  coexists = true;
  assert.ok(patched.includes("window.PLUGIN_LIST['steamgriddb']"), 'SteamGridDB\'s patch must still apply');
}
assert.ok(patched.includes('__cssLoaderBoot'), 'our hook must survive');

// The patched file must still parse. `new Function` parses without running it.
new Function(patched);

// The hook itself, without Steam, evaluating its file through a fake XMLHttpRequest.
const hook = /\(window\.__cssLoaderBoot\|\|[\s\S]*?\|\|function\(\)\{\}\)\)\(arguments\[0\],([\w$]+)\)/.exec(patched);
assert.ok(hook, 'the hook must be findable in the patched code');
const expression = hook[0].slice(0, hook[0].lastIndexOf('(arguments[0],'));
const requests = [];
const reading = (body) => class {
  open(method, url, async) { requests.push({ method, url, async }); }
  send() { if (body === null) throw new Error('offline'); this.responseText = body; }
};
const build = (target, body) => new Function('window', 'XMLHttpRequest', `return ${expression};`)(target, reading(body));

const target = {};
const script = '(function(n,w){w.push(n)})';
const run = build(target, script);
assert.equal(requests.length, 1, 'one read, when the hook is first defined');
assert.equal(requests[0].async, false, 'the read is synchronous, so styles are in before Steam renders');
assert.equal(requests[0].url, 'https://millennium.ftp/C%3A/Steam/millennium/plugins/css-loader/startup.js');
const seen = [];
run('SP Desktop_uid0', seen);
assert.deepEqual(seen, ['SP Desktop_uid0'], 'the file\'s function handles the window');
assert.equal(new Function('window', `return ${expression};`)(target), run, 'it is read only once');
for (const body of [null, '', 'not javascript(', 'undefined']) {
  const fallback = build({}, body);
  assert.doesNotThrow(() => fallback('SP Desktop_uid0', {}), `a missing or bad file means no styles, not an error: ${body}`);
}

console.log(`Serve patch check passed against the installed sp.js (${patchBytes} bytes)${coexists ? ', together with SteamGridDB\'s patch' : ''}.`);
