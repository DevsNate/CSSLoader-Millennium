// Brings upstream SDH-CssLoader changes into this port.
//
//   node scripts/sync-upstream.mjs [ref]     (default: upstream's main)
//
// package.json "upstream" records the upstream commit this port is based on.
// The script fetches upstream into refs/upstream/*, three-way applies the
// upstream diff from that commit to `ref` onto src/, and lists everything it
// can't apply: changes to files this port replaced or removed (the Python backend,
// build) and dependency changes. It then records `ref` as the new
// base. Nothing is committed; review with `git status` / `git diff`.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const fail = (message) => { console.error(message); process.exit(1); };

// Upstream files this port replaced or removed, with where their changes go instead.
const REPLACED = {
  'main.py': 'backend/main.lua, frontend/shims/server.ts, frontend/engine/translations.ts, frontend/engine/watch.ts',
  'css_loader.py': 'backend/engine/loader.lua',
  'css_theme.py': 'backend/engine/theme.lua',
  'css_themepatch.py': 'backend/engine/theme.lua',
  'css_themepatchcomponent.py': 'backend/engine/theme.lua',
  'css_inject.py': 'backend/engine/inject.lua, backend/engine/tabs.lua, backend/engine/classes.lua',
  'css_sfp_compat.py': 'backend/engine/theme.lua',
  'css_browserhook.py': 'frontend/delivery/',
  'css_utils.py': 'backend/engine/paths.lua, backend/main.lua',
  'css_remoteinstall.py': 'frontend/engine/store.ts, backend/main.lua',
  'css_server.py': 'removed in this port (standalone backend)',
  'css_win_tray.py': 'removed in this port (standalone backend)',
  'plugin.json': 'millennium.toml',
  'rollup.config.js': 'millennium.toml and tsconfig.json paths (Starlight build)',
};
const replacedBy = (file) => Object.entries(REPLACED).find(([path]) => path.endsWith('/') ? file.startsWith(path) : file === path)?.[1];

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const { repository, commit: base } = pkg.upstream ?? {};
if (!repository || !base) fail('package.json has no "upstream" { repository, commit } entry.');

try { git('rev-parse', '--git-dir'); } catch { fail('Run this inside the plugin\'s git repository.'); }
if (git('status', '--porcelain', '--', 'src', 'package.json').trim()) fail('Commit or stash your changes to src/ and package.json first.');

console.log(`Fetching ${repository}…`);
git('fetch', '--quiet', '--no-tags', repository, '+refs/heads/*:refs/upstream/heads/*', '+refs/tags/*:refs/upstream/tags/*');
const wanted = process.argv[2] ?? 'main';
const resolve = (name) => {
  for (const candidate of [`refs/upstream/heads/${name}`, `refs/upstream/tags/${name}`, name]) {
    try { return git('rev-parse', '--verify', '--quiet', `${candidate}^{commit}`).trim(); } catch { /* next */ }
  }
  fail(`Unknown upstream ref: ${name}`);
};
const target = resolve(wanted);
try { git('cat-file', '-e', `${base}^{commit}`); } catch { fail(`The recorded base ${base} is not in upstream's history.`); }
if (target === base) { console.log(`Already at upstream ${pkg.upstream.version} (${base.slice(0, 8)}).`); process.exit(0); }
const upstreamPackage = JSON.parse(git('show', `${target}:package.json`));
console.log(`Upstream ${pkg.upstream.version} (${base.slice(0, 8)}) → ${upstreamPackage.version} (${target.slice(0, 8)})\n`);

const changes = git('diff', '--name-status', '--no-renames', base, target).trim().split('\n').filter(Boolean)
  .map((line) => { const [status, file] = line.split('\t'); return { status, file }; });

// src/ files that still exist here (or are new upstream) get the three-way apply.
const applicable = changes.filter(({ status, file }) => file.startsWith('src/') && !replacedBy(file)
  && (status === 'A' || existsSync(new URL(`../${file}`, import.meta.url))));
const elsewhere = changes.filter((change) => !applicable.includes(change));

const conflicts = [];
const applied = [];
for (const { file } of applicable) {
  const patch = git('diff', '--binary', '--full-index', base, target, '--', file);
  const result = spawnSync('git', ['apply', '--3way', '--whitespace=nowarn'], { cwd: root, input: patch, encoding: 'utf8' });
  const unmerged = git('ls-files', '--unmerged', '--', file).trim();
  if (result.status === 0 && !unmerged) applied.push(file);
  else conflicts.push(unmerged ? file : `${file}  (not applied: ${(result.stderr || '').trim().split('\n').pop()})`);
}

const section = (title, lines) => { if (lines.length) console.log(`${title}\n${lines.map((line) => `  ${line}`).join('\n')}\n`); };
section(`Applied cleanly (${applied.length}):`, applied);
section(`Conflicts to resolve (${conflicts.length}); look for <<<<<<< and keep the "// Millennium:" edits:`, conflicts);
const note = ({ status, file }) => replacedBy(file)
  ?? (status === 'D' && !existsSync(new URL(`../${file}`, import.meta.url)) ? 'not in this port; nothing to do' : '');
section('Upstream changes to port by hand:', elsewhere.map((change) => `${change.status} ${change.file}${note(change) ? `  → ${note(change)}` : ''}`));

// Dependencies: this port vendors them (frontend/vendor) or maps them (tsconfig paths, shims).
const before = JSON.parse(git('show', `${base}:package.json`));
const dependencyChanges = [];
for (const field of ['dependencies', 'devDependencies']) {
  const [oldDeps, newDeps] = [before[field] ?? {}, upstreamPackage[field] ?? {}];
  for (const name of new Set([...Object.keys(oldDeps), ...Object.keys(newDeps)])) {
    if (oldDeps[name] !== newDeps[name]) dependencyChanges.push(`${name}: ${oldDeps[name] ?? '(none)'} → ${newDeps[name] ?? '(removed)'}`);
  }
}
section('Upstream dependency changes (vendored libraries: update package.json, then `pnpm vendor`; decky-frontend-lib: extend frontend/shims):', dependencyChanges);

pkg.upstream.version = upstreamPackage.version;
pkg.upstream.commit = target;
writeFileSync(new URL('../package.json', import.meta.url), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Recorded upstream ${upstreamPackage.version} (${target.slice(0, 8)}) in package.json.`);
console.log('Next: resolve conflicts, port the listed changes, then `pnpm build && pnpm check`.');
if (conflicts.length) process.exitCode = 1;
