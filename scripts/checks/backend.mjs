// Runs backend/ in fengari with stub Millennium modules and checks the theme
// engine, path validation, STORE import, the DeckThemes request limits, the
// startup file and the web page styles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createBackend, STARTUP_FILE, THEMES } from './lib/lua-backend.mjs';

const packed = process.argv.includes('--packed');
const source = packed
  ? execFileSync(process.execPath, ['node_modules/@steambrew/starlight/bin/starlight.js', '-i', 'dist/css-loader.star', '-q', 'backend:backend/main.lua'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  : undefined;

const theme = (backend, folder, json, extra = {}) => {
  if (json !== null) backend.setFile(`${THEMES}/${folder}/theme.json`, typeof json === 'string' ? json : JSON.stringify(json));
  for (const [name, text] of Object.entries(extra)) backend.setFile(`${THEMES}/${folder}/${name}`, text);
};
const fresh = () => createBackend({ source }).start();
const themes = (backend) => JSON.parse(backend.call('get_themes'));
const byName = (backend, name) => themes(backend).find((item) => item.name === name);
const styles = (backend) => JSON.parse(backend.call('get_styles', 0)).styles;
const result = (text) => JSON.parse(text);
const config = (backend, folder) => backend.getFile(`${THEMES}/${folder}/config_USER.json`);

// --- Plugin table and limits ------------------------------------------------
{
  const backend = fresh();
  assert.equal(backend.evaluate('type(plugin.on_load)'), 'function');
  assert.equal(backend.evaluate('type(plugin.patches)'), 'table');

  // Requests only go to DeckThemes, with safe paths.
  for (const [path, ok] of [
    ['/themes/abc', true], ['/motd', true], ['//evil.example/x', false], ['evil', false], ['/a b', false], ['/a\\b', false], ['/a#b', false],
  ]) {
    assert.equal(result(backend.call('store_request', 'GET', path, '', '')).success, ok, `store_request ${path}`);
  }
  assert.equal(result(backend.call('store_request', 'PUT', '/x', '', '')).success, false, 'other methods are refused');
  assert.equal(result(backend.call('store_request', 'GET', '/x', 'bad token', '')).success, false, 'a token with spaces is refused');
  backend.call('store_request', 'GET', '/x', 'tok', '');
  assert.equal(backend.evaluate('requests[#requests].options.headers.Authorization'), 'Bearer tok');
  assert.ok(backend.evaluate('requests[#requests].url').startsWith('https://api.deckthemes.com/'));

  // Files stay in the themes folder.
  for (const path of ['../x.css', 'a/../../x.css', 'C:/x.css', '/x.css', '\\\\server\\x.css', 'a/..\\..\\x']) {
    assert.equal(result(backend.call('write_theme_file', path, 'x')).success, false, `write_theme_file must refuse ${path}`);
  }
  assert.equal(result(backend.call('write_theme_file', 'T/a.css', 'x')).success, true);
  assert.equal(backend.getFile(`${THEMES}/T/a.css`), 'x');
}

// --- JSON -------------------------------------------------------------------
{
  const backend = fresh();
  backend.run(`pyjson = require('engine.pyjson')`);
  const round = (text) => backend.evaluate(`pyjson.encode(pyjson.decode(${JSON.stringify(text)}))`);
  assert.equal(round('{"z":1,"a":[true,null,{"é":"\\u00e9\\ud83d\\ude00"}],"m":{}, "n":[]}'),
    '{"z": 1, "a": [true, null, {"\\u00e9": "\\u00e9\\ud83d\\ude00"}], "m": {}, "n": []}', 'json.dumps format, key order, empties');
  assert.equal(round('"\\"\\\\\\n\\u0001\\u007f"'), '"\\"\\\\\\n\\u0001\\u007f"', 'escapes');
  assert.equal(round('[1.5,-2,1e3]'), '[1.5, -2, 1000]');
  for (const bad of ['{', '[1,]', '{"a"}', '"a', 'tru', '1 2', '{"a":1,}', '"a\nb"']) {
    assert.throws(() => backend.evaluate(`pyjson.decode(${JSON.stringify(bad)})`), /JSON/, `must refuse ${bad}`);
  }
  assert.equal(backend.evaluate(`pyjson.encode("a\\255b")`), '"a\\ufffdb"', 'bad UTF-8 can\'t break a reply');
  assert.equal(backend.evaluate(`pyjson.canonical(pyjson.decode('{"b":1,"a":2}')) == pyjson.canonical(pyjson.decode('{"a":2,"b":1}'))`), 'true');
}

// --- Loading ----------------------------------------------------------------
{
  const backend = fresh();
  theme(backend, 'Old', null, { 'theme.css': 'old{}' });
  theme(backend, 'Sfp', null, { 'webkit.css': 'w{}', 'libraryroot.custom.css': 'l{}' });
  theme(backend, 'Empty', null, { 'readme.txt': 'x' });
  theme(backend, 'Broken', '{ not json');
  theme(backend, 'Newer', { name: 'Newer', manifest_version: 99 });
  theme(backend, 'b-order', `{"name":"Order","id":"x","version":"2","author":"me","inject":{"b.css":["desktop"],"a.css":["SP"],"--v":["1px","Steam"]},
    "patches":{"Zed":{"values":{"Second":{"z2.css":["Steam"]},"First":{"z1.css":["Steam"]}}},"Alpha":{"default":"On","Off":{},"On":{"o.css":["Steam"]}}}}`,
  { 'b.css': 'b{}', 'a.css': 'a{}', 'z1.css': 'z1{}', 'z2.css': 'z2{}', 'o.css': 'o{}', PRIORITY: '5\n' });
  theme(backend, 'Dupe1', { name: 'Same' });
  theme(backend, 'Dupe2', { name: 'Same' });
  backend.load();
  assert.equal(backend.evaluate('ready_calls'), '1', 'on_load says it is ready');
  assert.equal(backend.evaluate('#writes') , '1', 'loading writes only the startup file when there is nothing to style');

  const list = themes(backend);
  assert.deepEqual(list.map((item) => item.name), ['Old', 'Order', 'Same', 'Same_0', 'Sfp'], 'sorted by display name');
  const order = list.find((item) => item.name === 'Order');
  assert.deepEqual(order.patches.map((patch) => patch.name), ['Zed', 'Alpha'], 'patches keep theme.json order');
  assert.deepEqual(order.patches[0].options, ['Second', 'First'], 'options keep theme.json order');
  assert.equal(order.patches[0].default, 'Second', 'the first option is the default');
  assert.equal(order.patches[1].default, 'On');
  assert.deepEqual(order.dependencies, [], 'an empty list stays a list');
  assert.equal(list.find((item) => item.name === 'Same_0').display_name, 'Same');

  const errors = JSON.parse(backend.call('get_last_load_errors')).fails;
  assert.deepEqual(errors.map(([folder]) => folder).sort(), ['Broken', 'Empty', 'Newer']);
  assert.match(errors.find(([folder]) => folder === 'Newer')[1], /Read manifest version 99 but only up to 9/);
  assert.match(errors.find(([folder]) => folder === 'Empty')[1], /does not look like a theme/);

  // Enabling: injects in theme.json order, then the selected options.
  assert.equal(result(backend.call('set_theme_state', 'Order', true, true, true)).success, true);
  const injected = styles(backend);
  assert.deepEqual(injected.map((style) => style.css), ['b{}', 'a{}', ':root { --v: 1px; }', 'z2{}', 'o{}']);
  assert.deepEqual(injected[0].tabs, ['Steam|SteamLibraryWindow'], 'tabs are extended');
  assert.deepEqual(injected[1].tabs, ['~Valve Steam Gamepad/default~', '~Valve%20Steam%20Gamepad~'], 'through legacy names');
  assert.deepEqual(injected[2].tabs, ['Steam|SteamLibraryWindow'], 'a variable\'s first "tab" is its value');
  assert.equal(config(backend, 'b-order'), '{"active": true, "Zed": "Second", "Alpha": "On"}', 'config_USER.json as Python writes it');

  // A patch moves its styles last; re-injecting makes new ids.
  const before = injected.map((style) => style.id);
  assert.equal(result(backend.call('set_patch_of_theme', 'Order', 'Zed', 'First')).success, true);
  const after = styles(backend);
  assert.deepEqual(after.map((style) => style.css), ['b{}', 'a{}', ':root { --v: 1px; }', 'o{}', 'z1{}']);
  assert.ok(!before.includes(after.at(-1).id), 'a new element');
  assert.equal(result(backend.call('set_patch_of_theme', 'Order', 'Zed', 'First')).message, 'Already injected');
  assert.equal(result(backend.call('set_patch_of_theme', 'Nope', 'Zed', 'First')).success, false);
  assert.equal(config(backend, 'b-order'), '{"active": true, "Zed": "First", "Alpha": "On"}');

  // Nothing changed: nothing is written.
  backend.run('writes = {}');
  backend.call('set_theme_state', 'Order', true, true, true);
  assert.ok(!backend.json('writes').some((path) => path.endsWith('config_USER.json')), 'same config: no write');

  assert.equal(result(backend.call('set_theme_state', 'Order', false, true, true)).success, true);
  assert.deepEqual(styles(backend), [], 'disabling removes every style');
  assert.equal(config(backend, 'b-order'), '{"active": false, "Zed": "First", "Alpha": "On"}');
  backend.close();
}

// --- Startup: active themes from config_USER.json, nothing rewritten ---------
{
  const backend = fresh();
  theme(backend, 'On', { name: 'On', inject: { 'a.css': ['Steam'] } }, { 'a.css': 'a{}', 'config_USER.json': '{ "active" : true }' });
  theme(backend, 'Later', { name: 'Later', inject: { 'b.css': ['Steam'] } }, { 'b.css': 'b{}', 'config_USER.json': '{"active": true}', PRIORITY: '3' });
  theme(backend, 'Off', { name: 'Off', inject: { 'c.css': ['Steam'] } }, { 'c.css': 'c{}', 'config_USER.json': '{"active": false}' });
  theme(backend, 'Dep', { name: 'Dep', inject: { 'd.css': ['Steam'] } }, { 'd.css': 'd{}', 'config_USER.json': '{"active": true}' });
  theme(backend, 'Top', { name: 'Top', dependencies: { Dep: {} }, inject: { 't.css': ['Steam'] } }, { 't.css': 't{}', 'config_USER.json': '{"active": true}' });
  backend.load();
  assert.deepEqual(backend.json('writes').filter((path) => !path.includes('/css-loader/')), [], 'starting up writes nothing in theme folders');
  assert.equal(config(backend, 'On'), '{ "active" : true }');
  assert.deepEqual(styles(backend).map((style) => style.css), ['d{}', 'a{}', 't{}', 'b{}'], 'dependencies first, then priority');

  const text = backend.getFile(STARTUP_FILE);
  assert.ok(text.startsWith('(function(d){'), 'the startup file is a script');
  const appended = [];
  const popup = {
    location: { href: 'about:blank' },
    document: {
      title: 'Steam', documentElement: { classList: [] }, body: null,
      head: { classList: [], appendChild: (el) => appended.push(el) },
      createElement: () => ({}),
    },
  };
  const hook = (0, eval)(`var window = {}; ${text}`);
  hook('SP Desktop_uid0', popup);
  assert.deepEqual(appended.map((el) => el.textContent), ['d{}', 'a{}', 't{}', 'b{}']);
  assert.deepEqual(appended.map((el) => el.id), styles(backend).map((style) => style.id), 'same ids, so the frontend keeps these elements');
  assert.equal(appended[0].className, 'css-loader-style');
  assert.equal(hook.d.length, 4, 'the frontend reads the styles from .d');
  backend.close();
}

// --- Dependencies and presets -----------------------------------------------
{
  const backend = fresh();
  theme(backend, 'Base', { name: 'Base', inject: { 'a.css': ['Steam'] }, patches: { Size: { values: { S: { 's.css': ['Steam'] }, L: { 'l.css': ['Steam'] } } } } },
    { 'a.css': 'base{}', 's.css': 's{}', 'l.css': 'l{}' });
  theme(backend, 'Top', { name: 'Top', dependencies: { Base: { Size: 'L' } }, inject: { 't.css': ['Steam'] } }, { 't.css': 'top{}' });
  theme(backend, 'CycleA', { name: 'CycleA', dependencies: { CycleB: {} } });
  theme(backend, 'CycleB', { name: 'CycleB', dependencies: { CycleA: {} } });
  backend.load();

  assert.equal(result(backend.call('set_theme_state', 'Top', true, true, true)).success, true);
  assert.deepEqual(styles(backend).map((style) => style.css), ['base{}', 'l{}', 'top{}'], 'a dependency comes first, with the values asked for');
  assert.equal(byName(backend, 'Base').enabled, true);

  assert.equal(result(backend.call('generate_preset_theme', 'My Set')).success, true);
  assert.equal(backend.getFile(`${THEMES}/My Set.profile/theme.json`),
    '{"display_name": "My Set", "name": "My Set.profile", "manifest_version": 9, "flags": ["PRESET"], "dependencies": {"Base": {"Size": "L"}, "Top": {}}}',
    'a preset as upstream writes it');
  backend.call('reset');
  const preset = byName(backend, 'My Set.profile');
  assert.equal(preset.display_name, 'My Set');
  assert.deepEqual(preset.flags, ['PRESET']);
  assert.deepEqual(preset.dependencies, ['Base', 'Top']);
  assert.equal(result(backend.call('generate_preset_theme_from_theme_names', 'Named', '["Base"]')).success, true);
  assert.match(backend.getFile(`${THEMES}/Named.profile/theme.json`), /"dependencies": \{"Base": \{"Size": "L"\}\}/);
  assert.equal(result(backend.call('generate_preset_theme', 'Base')).success, false, 'a theme\'s name is taken');

  assert.equal(result(backend.call('set_theme_state', 'Top', false, true, true)).success, true);
  assert.equal(byName(backend, 'Base').enabled, false, 'a dependency nobody needs goes too');

  assert.equal(result(backend.call('delete_theme', 'Top')).success, true);
  assert.equal(backend.getFile(`${THEMES}/Top/theme.json`), '');
  assert.equal(byName(backend, 'Top'), undefined);
  assert.equal(result(backend.call('delete_theme', 'Top')).success, false);
  backend.close();
}

// --- Components -------------------------------------------------------------
{
  const backend = fresh();
  const component = (extra) => ({ name: 'C', type: 'color-picker', default: '#102030', on: 'On', css_variable: 'col', tabs: ['Steam'], ...extra });
  theme(backend, 'Col', { name: 'Col', patches: { P: { default: 'On', values: { On: {}, Off: {} }, components: [component({})] } } },
    { 'img/a b.png': 'x', 'img/bg (1).png': 'x' });
  theme(backend, 'Img', { name: 'Img', patches: { P: { values: { On: {} }, components: [component({ type: 'image-picker', default: 'Col/img/a b.png', css_variable: '--pic' })] } } });
  theme(backend, 'BadImg', { name: 'BadImg', patches: { P: { values: { On: {} }, components: [component({ type: 'image-picker', default: 'missing.png' })] } } });
  theme(backend, 'BadOn', { name: 'BadOn', patches: { P: { values: { On: {} }, components: [component({ on: 'Nope' })] } } });
  backend.load();
  const errors = JSON.parse(backend.call('get_last_load_errors')).fails.map(([folder]) => folder).sort();
  assert.deepEqual(errors, ['BadImg', 'BadOn']);

  backend.call('set_theme_state', 'Col', true, true, true);
  assert.equal(styles(backend)[0].css, ':root { --col: #102030; --col_r: 16; --col_g: 32; --col_b: 48; --col_rgb: 16, 32, 48; }');
  const set = (value) => result(backend.call('set_component_of_theme_patch', 'Col', 'P', 'C', value));
  assert.equal(set('hsla(120, 100%, 50%, 1)').success, true);
  assert.equal(styles(backend)[0].css, ':root { --col: hsla(120, 100%, 50%, 1); --col_r: 0; --col_g: 255; --col_b: 0; --col_rgb: 0, 255, 0; }');
  assert.equal(set('#abc').success, true);
  assert.equal(styles(backend)[0].css, ':root { --col: #abc; --col_r: 10; --col_g: 11; --col_b: 12; --col_rgb: 10, 11, 12; }', 'upstream reads short hex one digit at a time');
  assert.equal(set('red').success, true);
  assert.equal(styles(backend)[0].css, ':root { --col: red; }', 'anything else is passed through');
  assert.equal(set('a;b').success, false, 'a semicolon is refused');
  assert.equal(styles(backend)[0].css, ':root { --col: red; }', 'and the old value stays');
  assert.equal(config(backend, 'Col'), '{"active": true, "P": {"value": "On", "components": {"C": "red"}}}');

  backend.call('set_theme_state', 'Img', true, true, true);
  assert.equal(styles(backend)[1].css, `:root { --pic: url(https://millennium.ftp/C%3A/Users/T/homebrew/themes/Col/img/a%20b.png) }`);
  assert.equal(result(backend.call('set_component_of_theme_patch', 'Img', 'P', 'C', 'Col/img/bg (1).png')).success, true);
  assert.equal(styles(backend)[1].css, `:root { --pic: url(https://millennium.ftp/C%3A/Users/T/homebrew/themes/Col/img/bg%20%281%29.png) }`, 'brackets are escaped in an unquoted url()');
  assert.equal(result(backend.call('set_component_of_theme_patch', 'Img', 'P', 'C', 'nope.png')).success, false, 'the image must exist');
  assert.equal(result(backend.call('set_component_of_theme_patch', 'Img', 'P', 'C', '../x.png')).success, false, 'and stay in the folder');
  backend.close();
}

// --- CSS passes: class translations and asset URLs --------------------------
{
  const backend = fresh();
  backend.setFile(`${THEMES}/css_translations.json`, JSON.stringify({ u1: ['old1', 'old2', 'new'], u2: ['other', 'other2'] }));
  const css = '.old1 .old2.x, .unmapped, [class*="old1"], [class^="other"] a { background: url(/themes_custom/T/a.png); b: url( \'/themes_custom/T/b c.png\'); c: url(/other.png) }';
  theme(backend, 'T', { name: 'T', inject: { 'a.css': ['Steam'] } }, { 'a.css': css, 'config_USER.json': '{"active": true}' });
  backend.load();
  assert.equal(styles(backend)[0].css,
    '.new .new.x, .unmapped, [class*="new"], [class^="other2"] a { background: url(https://millennium.ftp/C%3A/Users/T/homebrew/themes/T/a.png); b: url(\'https://millennium.ftp/C%3A/Users/T/homebrew/themes/T/b c.png\'); c: url(/other.png) }');

  // A new map reloads the themes; the same one doesn't. The frontend downloads
  // it; the backend never waits on the network for it.
  backend.run('requests = {}');
  const map = JSON.stringify({ u1: ['old1', 'newer'] });
  assert.equal(result(backend.call('save_translations', map)).changed, true);
  assert.match(styles(backend)[0].css, /^\.newer /);
  assert.equal(backend.getFile(`${THEMES}/css_translations.json`), map);
  assert.equal(result(backend.call('save_translations', map)).changed, false);
  assert.equal(result(backend.call('save_translations', 'not json')).success, false);
  assert.equal(result(backend.call('save_translations', '')).success, false);
  assert.equal(backend.getFile(`${THEMES}/css_translations.json`), map, 'a bad download keeps the old map');
  assert.equal(backend.evaluate('#requests'), '0');

  // Even with a stock steamui\themes_custom link, assets use the file route.
  backend.setFile('C:/Steam/steamui/themes_custom/T/a.png', 'x');
  backend.call('reset');
  assert.match(styles(backend)[0].css, /url\(https:\/\/millennium\.ftp\//);
  backend.close();
}

// --- Paths in theme.json ----------------------------------------------------
{
  const backend = fresh();
  backend.setFile('C:/Users/T/homebrew/secret.css', 'secret{}');
  theme(backend, 'Escape', { name: 'Escape', inject: { '../../secret.css': ['Steam'] } }, { 'config_USER.json': '{"active": true}' });
  theme(backend, 'Inside', { name: 'Inside', inject: { 'sub/../a.css': ['Steam'] } }, { 'a.css': 'inside{}', 'config_USER.json': '{"active": true}' });
  backend.load();
  assert.deepEqual(styles(backend).map((style) => style.css), ['inside{}'], 'CSS outside the themes folder is never read');
  backend.close();
}

// --- Scope and web pages ----------------------------------------------------
{
  const backend = fresh();
  const id = '11111111-2222-3333-4444-555555555555';
  backend.run(`config.catalogScopes = { ['${id}'] = 'desktop' }`);
  theme(backend, 'Desk', { name: 'Desk', id, inject: { 'a.css': ['store'] } }, { 'a.css': 'desk{}', 'config_USER.json': '{"active": true}' });
  theme(backend, 'Pad', { name: 'Pad', inject: { 'b.css': ['~https://store.steampowered.com~', '~https://store.steampowered.com~', 'SP'] } },
    { 'b.css': 'pad{}', 'config_USER.json': '{"active": true}', '.css-loader-scope.json': '{"scope":"gamepad"}' });
  backend.load();
  assert.deepEqual(styles(backend).map((style) => style.scope), ['desktop', 'gamepad']);
  const web = () => {
    const hooks = backend.json(`(function() local list = require('engine.pyjson').array({}); for _, hook in pairs(registered) do list[#list+1] = hook.pattern .. ' => ' .. files[hook.path] end; table.sort(list); return list end)()`);
    return hooks;
  };
  assert.deepEqual(web(), [
    '.*https:\\/\\/steamcommunity\\.com.* => desk{}',
    '.*https:\\/\\/store\\.steampowered\\.com.* => desk{}\npad{}',
  ], 'with no UI mode known, every scope; a spec counts once per style');
  backend.call('set_ui_mode', 'desktop');
  assert.deepEqual(web(), [
    '.*https:\\/\\/steamcommunity\\.com.* => desk{}',
    '.*https:\\/\\/store\\.steampowered\\.com.* => desk{}',
  ], 'the UI mode filters store pages');
  assert.equal(backend.getFile('C:/Steam/millennium/plugins/css-loader/ui-mode'), 'desktop', 'and is remembered for the next start');
  backend.call('set_ui_mode', 'gamepad');
  assert.deepEqual(web(), ['.*https:\\/\\/store\\.steampowered\\.com.* => pad{}']);

  // Categories come from DeckThemes, once.
  const unknown = 'aaaaaaaa-2222-3333-4444-555555555555';
  theme(backend, 'New', { name: 'New', id: unknown, inject: { 'n.css': ['Steam'] } }, { 'n.css': 'n{}', 'config_USER.json': '{"active": true}' });
  backend.call('reset');
  const stranger = 'bbbbbbbb-2222-3333-4444-555555555555';
  theme(backend, 'Gone', { name: 'Gone', id: stranger, inject: { 'g.css': ['Steam'] } }, { 'g.css': 'g{}' });
  backend.call('reset');
  backend.run(`http_reply = { status = 500, body = '' }; requests = {}`);
  assert.deepEqual(result(backend.call('refresh_catalog_scopes')), { changed: false, more: false }, 'offline: try next start');
  assert.equal(backend.evaluate('requests[1].options.timeout'), '8', 'with a short timeout');
  backend.run(`http_reply = { status = 200, body = ${JSON.stringify(JSON.stringify([{ id: unknown, targets: ['Desktop', 'Desktop-Library'] }]))} }; requests = {}`);
  assert.deepEqual(result(backend.call('refresh_catalog_scopes')), { changed: true, more: false });
  assert.match(backend.evaluate('requests[1].url'), /\/themes\/ids\?ids=bbbbbbbb-[-0-9a-f]+\.aaaaaaaa-/);
  assert.equal(styles(backend).find((style) => style.css === 'n{}').scope, 'desktop');
  assert.equal(backend.evaluate(`config.catalogScopes['${stranger}']`), 'all', 'an id DeckThemes does not know is remembered');
  backend.run('requests = {}');
  assert.deepEqual(result(backend.call('refresh_catalog_scopes')), { changed: false, more: false });
  assert.equal(backend.evaluate('#requests'), '0', 'and not asked about again');

  // Large libraries go in steps, so other calls never wait long.
  const many = Array.from({ length: 45 }, (_, index) => `cccccccc-2222-3333-4444-${String(index).padStart(12, '0')}`);
  many.forEach((manyId, index) => theme(backend, `M${index}`, { name: `M${index}`, id: manyId, inject: {} }));
  backend.call('reset');
  backend.run(`http_reply = { status = 200, body = '[]' }; requests = {}`);
  assert.deepEqual(result(backend.call('refresh_catalog_scopes')), { changed: true, more: true });
  assert.equal(backend.evaluate('#requests'), '1');
  assert.deepEqual(result(backend.call('refresh_catalog_scopes')), { changed: true, more: false });

  // A broken cache value never becomes a scope.
  backend.run(`config.catalogScopes['${id}'] = 'bogus'`);
  backend.call('reset');
  assert.equal(styles(backend).find((style) => style.css === 'desk{}').scope, 'all');
  for (const [targets, scope] of [[['Desktop', 'Desktop-Library'], 'desktop'], [['Store'], 'gamepad'], [['Desktop', 'Store'], 'all'], [[], 'all']]) {
    backend.run(`__t = require('engine.pyjson').decode(${JSON.stringify(JSON.stringify(targets))})`);
    assert.equal(backend.evaluate(`require('engine.catalog').scope_for_targets(__t)`), scope);
  }
  backend.close();
}

// --- Large profiles: replies stay under Millennium's limit -------------------
{
  const backend = fresh();
  const inject = {};
  const large = 'x'.repeat(1024 * 1024);
  for (let index = 0; index < 5; index++) {
    inject[`${index}.css`] = ['Steam'];
    backend.setFile(`${THEMES}/Big/${index}.css`, large + index);
  }
  theme(backend, 'Big', { name: 'Big', inject }, { 'config_USER.json': '{"active": true}' });
  backend.load();
  const first = JSON.parse(backend.call('get_styles', 0));
  assert.ok(first.pages > 1, 'large style lists are split');
  let count = 0;
  for (let page = 0; page < first.pages; page++) count += JSON.parse(backend.call('get_styles', page)).styles.length;
  assert.equal(count, 5);
  backend.close();
}

// --- Smaller backend rules ---------------------------------------------------
{
  const backend = fresh();
  theme(backend, 'Var', { name: 'Var', inject: { '--empty': [] } }, { 'config_USER.json': '{"active": true}' });
  theme(backend, 'List', { name: 'List', inject: { 'l.css': ['Steam'] } }, { 'l.css': 'l{}', 'config_USER.json': '{"active": []}' });
  backend.load();
  const errors = JSON.parse(backend.call('get_last_load_errors')).fails;
  assert.deepEqual(errors.map(([folder]) => folder), ['Var'], 'a CSS variable with no value is a load error');
  assert.equal(JSON.parse(backend.call('get_themes')).find((item) => item.name === 'List').enabled, false, 'an empty list is false, as in Python');

  // A restarted backend's revision never repeats an old one.
  assert.ok(JSON.parse(backend.call('get_styles', 0)).revision > 1e12);

  // A file that can't be replaced keeps its old text.
  backend.setFile('C:/x/keep.txt', 'old');
  backend.run(`local rename = require('fs').rename; require('fs').rename = function() return false, 'locked' end
    __ok = require('engine.paths').write_atomic('C:/x/keep.txt', 'new')
    require('fs').rename = rename`);
  assert.equal(backend.evaluate('tostring(__ok)'), 'false');
  assert.equal(backend.getFile('C:/x/keep.txt'), 'old');
  assert.equal(backend.getFile('C:/x/keep.txt.tmp'), '');
  backend.close();
}

// --- on_load must always say it is ready --------------------------------------
{
  const backend = fresh();
  backend.run(`require('engine.loader').load = function() error('boom') end`);
  backend.load();
  assert.equal(backend.evaluate('ready_calls'), '1');
  backend.close();
}

// --- No deprecated APIs -------------------------------------------------------
const all = [new URL('../../backend/main.lua', import.meta.url)].map((file) => readFileSync(file, 'utf8')).join('');
assert.ok(!/AddWindowCreateHook|callServerMethod|exposeObj/.test(all), 'no deprecated APIs');

console.log(`Backend check passed${packed ? ' (packed)' : ''}.`);
