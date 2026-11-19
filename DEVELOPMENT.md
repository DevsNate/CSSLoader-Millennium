# Development

## Building
```bash
pnpm install
pnpm run build
```
The package is written to `dist/css-loader.star`; building does not install it
or restart Steam. A plain `starlight pack -o dist` (with `dist/` already created)
also builds it with no install, which is how Millennium's plugin database builds
plugins: the small libraries are committed in `frontend/vendor/`.

| Command | What it does |
|---|---|
| `pnpm dev` | Rebuilds on change |
| `pnpm check` | Runs every check in `scripts/checks/`; build first. The serve-patch check uses the installed Steam client (set `STEAM_PATH` if it isn't in the default folder) and skips without one |
| `pnpm vendor` | Regenerates `frontend/vendor/` after a dependency or icon change |

Don't run `starlight lsp` here: it overwrites the `paths` in `tsconfig.json` that
map `decky-frontend-lib` and the small libraries to this repository's copies.

## Project layout
```
backend/main.lua          Lua backend entry: the calls the frontend makes, DeckThemes
                          requests, and the Steam patch for first paint
backend/engine/           Port of upstream's Python theme engine (Loader, Theme,
                          ThemePatch, ...) and what it writes: the startup styles
                          and store page styles
frontend/                 Millennium side of upstream's frontend
  index.tsx               Entry
  engine/                 Calls into the backend; theme install, translations,
                          live CSS editing
  delivery/               Gets styles into windows and pages
  shims/                  Stand-ins for decky-frontend-lib and upstream's ServerAPI
  desktop-window/         Desktop window for upstream's pages
  vendor/                 Committed libraries (generated)
src/                      Upstream's frontend, same layout; edits marked // Millennium:
docs/design.md            Where the code went and why
scripts/                  vendor, sync-upstream, and checks/
```

## Differences in detail
- CSS is injected as written. Decky's plugin escapes backslashes for an old
  transport, which breaks selectors with CSS escapes.
- A `.css-loader-scope.json` file in a theme's folder overrides the mode a
  theme applies in: `{ "scope": "all" }`, `"desktop"` or `"gamepad"`.
- Sliders whose labels don't fit the Quick Access panel label only their ends
  and show the current value next to the name.
- Theme upload isn't ported (upstream's interface never calls it).
- Theme images load through Millennium's file route
  (`https://millennium.ftp/<path>`), so nothing is written into Steam's
  `steamui` folder.
- To use another themes folder, set `themesPath` in the plugin's Millennium
  config. Settings from Decky's `STORE` file are imported once.

## Files the plugin writes
In the themes folder, what upstream writes: installed themes, each theme's
`config_USER.json`, profiles (`<name>.profile` folders) and
`css_translations.json`, the map of Steam's class names from DeckThemes.

In `Steam/millennium/plugins/css-loader/`:

| File | What it holds |
|---|---|
| `startup.js` | The enabled styles, so windows Steam opens before the plugin has loaded are themed at first paint |
| `ui-mode` | The last mode used, desktop or Big Picture, for store pages opened before the plugin loads |
| `web/*.css` | Styles for store and community pages |

Settings, including the DeckThemes login, are kept in Millennium's config,
`Steam/millennium/config/config.json`, in plain text.

## Updating from upstream
`package.json` records the upstream version and commit under `"upstream"`.
```bash
pnpm sync-upstream          # upstream's main, or: pnpm sync-upstream <branch|tag|commit>
```
This three-way applies upstream's `src/` changes, leaves conflict markers where
they meet a `// Millennium:` edit, lists what has to be ported by hand (Python
goes to `backend/engine/` and `backend/main.lua`), then records the new base.
Nothing is committed. Finish with `pnpm build && pnpm check`.

## How this port was made
The port was written with AI assistance (Claude) and reviewed and tested by the
maintainer. `src/` is upstream's code, about 6,000 lines, with 5 files changed by
a few marked lines each. The new code is about 2,700 lines of Lua in `backend/`
and 2,000 lines of TypeScript in `frontend/`, the theme engine in
`backend/engine/` being a close port of upstream's Python.
