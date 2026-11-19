# Design notes

This is a port of [DeckThemes/SDH-CssLoader](https://github.com/DeckThemes/SDH-CssLoader)
2.1.3 to a Millennium (Starlight) plugin: one `.star`, a Lua backend and the
upstream frontend. These notes say where the code went and why.

## Where the code lives

| Upstream | Here | Why |
|---|---|---|
| `src/` (frontend, decky-frontend-lib 3) | `src/`, edits marked `// Millennium:` | Keeps upstream recognisable and mergeable (`pnpm sync-upstream`). |
| `css_loader.py`, `css_theme.py`, `css_themepatch.py`, `css_themepatchcomponent.py`, `css_inject.py`, `css_sfp_compat.py` | `backend/engine/` (Lua) | The engine stays in the backend, as upstream's did, with the same classes (Loader, Theme, ThemePatch, ThemePatchComponent, Inject) so the files can be read side by side. It can build the styles from the theme files before anything in Steam loads. `engine/pyjson.lua` keeps object key order, which Millennium's `json` module doesn't, and writes files the way Python's `json.dumps` does. |
| `css_browserhook.py` | `frontend/delivery/` | Same order of styles (add, remove, re-inject on reload, health check), but over Millennium's in-process means instead of the CEF debugging port. Windows live in the shared JS context, so this stays in the frontend; it gets its list from the backend (`get_styles`) after each change. |
| `main.py`, `css_utils.py`, `css_remoteinstall.py` | `backend/main.lua` + `frontend/engine/store.ts` | Lua does file IO and HTTP; the zip is unpacked in the frontend (Chromium's `DecompressionStream`), because Lua has no unzip, and written back through validated Lua calls. |
| `css_server.py`, `css_win_tray.py`, standalone mode | dropped | Only served CSSLoader-Desktop. |
| `ServerAPI.callPluginMethod` (29 call sites) | `frontend/shims/server.ts` | One object with the same method names and `{ success, result }` replies; upstream calls it unchanged. |
| `decky-frontend-lib` | `frontend/shims/decky-frontend-lib/` | Re-exports Millennium's equivalents. |

## Delivery per target type

Stock CSS Loader attaches to every page over the CEF remote-debugging port and
compares each tab against a theme's tab list (`~url~`, `!class`, title regex,
`DEFAULT_MAPPINGS`, per-theme `tabs`). Names are resolved in `backend/engine/tabs.lua` and
matched in `frontend/delivery/tabs.ts`, unchanged. Only the transport changes:

| Target | Examples | Transport |
|---|---|---|
| Windows Steam creates through `g_PopupManager` | desktop main window (`Steam`), friends/chat, context menus and supernavs, desktop popups, the Big Picture window (`SP BPM_uid0`, URL has `Valve Steam Gamepad`) | Direct DOM in the shared JS context: `<style class="css-loader-style">` elements in the window's head. |
| Separate browser targets | Big Picture Quick Access and Main Menu, notification toasts, overlay browser | Millennium's per-plugin `ChromeDevToolsProtocol` (`Target.attachToTarget` + `Runtime.evaluate`), driven by the `Target.targetCreated/InfoChanged/Destroyed` events Millennium already discovers. `Page.addScriptToEvaluateOnNewDocument` re-applies after a reload. |
| Web pages | store.steampowered.com, steamcommunity.com | Serve time: CSS files the backend generates and registers with `millennium.add_browser_css`, which Millennium links into the page's `<head>` as it is served. Live changes go over CDP like the row above. |

The external debugging port and `.cef-enable-remote-debugging` are never used.

## First paint

* **The backend runs first.** `on_load` reads the themes and writes
  `startup.js` (the active styles and a small matcher) before it calls
  `millennium.ready()`. It's rebuilt from the theme files at every start and after
  every change, so a theme edited while Steam is closed is right straight away, and
  so is the first start after install.
* **Every window Steam creates:** Steam's `CreatePopup` is patched when `sp.js` is
  served (`backend/main.lua` `patches`). The hook runs after Steam writes the
  window's document and before it renders into it. The first time, it reads
  `startup.js` synchronously and evaluates it; that's how the windows Steam opens
  before the frontend has loaded get their styles. Once the frontend is loaded the
  same hook hands windows to it. The frontend's list has the same ids as the
  startup file, so its arrival changes nothing on screen.
* **Why a synchronous read and `eval`:** nothing else runs early enough and blocks
  rendering. Millennium serves plugin scripts as deferred modules, and a stylesheet
  added by script doesn't hold back rendering. The file is one the backend generated
  in its own data folder. If it can't be read or evaluated, windows get their styles
  when the frontend loads.
* **The patch is small and fixed in size** (about 400 bytes, no user data).
  Millennium v3.6.2 writes every plugin's patches to a pipe of about 4 KB while Steam
  launches its web helper, before anything reads it, so a longer list stops Steam
  from starting (fixed after v3.6.2, #947).
* **Store/community pages:** render-blocking `<link>` in the served HTML.
* **Quick Access / Main Menu:** hidden when Steam creates them; styled through
  CDP as soon as the target appears, and on every reload through a document
  start script.

Changes after a user action (toggling a theme, a patch, a colour) apply live.

## Asset URLs

Themes reference images and fonts as `/themes_custom/<theme>/...`, which stock
serves by symlinking `steamui\themes_custom` to the themes folder. This port
rewrites `url(/themes_custom/...)` in theme CSS and in image-picker components to
Millennium's file route `https://millennium.ftp/<absolute path>` (an internal
route of Millennium's network hook, used for plugin bundles; it serves images and
fonts with the right MIME type) on stock Millennium, with no Developer Mode or
admin rights, which a symlink would need on Windows. Nothing is symlinked or
written into `steamui`.

## Layering

Millennium adds its theme's sheets when a window is created. CSS Loader's
`<style>` elements are appended after them and kept last, so CSS Loader wins
equal-specificity rules, as it does on top of Steam's own CSS under Decky. The
Millennium theme is never touched.

## Data

* Themes: `%USERPROFILE%\homebrew\themes` by default (setting `themesPath`), the
  same folder and file formats as Decky CSS Loader (`theme.json`,
  `config_USER.json`, `PRIORITY`, `css_translations.json`). Theme folders are
  only written by the user's own actions (install, update, delete, presets,
  saving a theme's options); stock also rewrites `config_USER.json` at every start.
* Settings: Millennium plugin config. The old `STORE` file is imported once.
* Generated files: `<Steam>\millennium\plugins\css-loader\` (`startup.js`, the last
  UI mode and the web page CSS files). They can all be deleted; the next start
  writes them again.

## Deliberate differences from stock

* CSS is injected as written. Stock escapes backslashes twice for an old
  JavaScript-string transport, which breaks selectors with CSS escapes
  (e.g. Catppuccini's controller settings rules).
* DeckThemes catalog scope: a theme listed only as a desktop (or only as a Big
  Picture) theme is applied only in that UI mode. This matters for the store
  pages, which both modes share. Stock had no desktop mode to tell apart.
  `.css-loader-scope.json` in a theme folder overrides it.
* No standalone backend, tray icon or theme upload (upstream's frontend never
  calls upload).
* Live CSS editing polls file times every two seconds while it is on, instead
  of a file system watcher.

## Differences from Decky that shaped the port

* **`alwaysRender`:** Decky keeps upstream's panel mounted, and two of its effects
  (fetching the theme list, tracking the selected profile) feed the store and
  settings pages. Millennium mounts the panel only while it's open, so
  `frontend/index.tsx` does both itself.
* **`Tabs`:** the SDK's component waits for `window.DeckyPluginLoader` and shows a
  spinner forever without Decky. `frontend/shims/decky-frontend-lib/tabs.tsx` finds
  Steam's component through the tab header in the same webpack module, with a
  plain tab row as the fallback.
* **`classMap`:** the SDK's is one merged object; upstream expects the module list,
  which the SDK exports as `classMapList`.
* **Routes** are not `exact`: the settings sidebar lives on `/cssloader/settings/<page>`.
* **Big Picture root:** current Steam names it `GamepadUI_Full_Root`, not `root_1_`.
* **Popup URLs:** `document.open()` gives a popup its opener's URL, so a Big Picture
  window's `location.href` lacks the `Valve Steam Gamepad` address CDP reports. The
  startup file and `DocumentTab` add it for that window so themes' URL specs match.
* **CDP targets can change kind:** a target can start as a Steam window and navigate
  to the store, and a probe can land between documents. `cdp.ts` re-checks `direct`
  targets that sit on a web URL, and treats "no document yet" as "retry".

## Measured first paint

Times are from the page's own clock, sampled over page-level CDP during development,
on a profile of 102 styles (71 KB).

| Window | Styles first seen | First paint |
|---|---|---|
| Big Picture, cold Steam start | 23 ms, before `<body>` existed | 260 ms |
| Big Picture, cold start with no `startup.js` (as after install) | 245 ms (first sample) | 292 ms |
| Desktop main window, switching from Big Picture | 75 ms, before `<body>` rendered | 471 ms |

The old TypeScript engine and this one were also run side by side over the same 75
themes, through every toggle and every option: the styles, their order and
`config_USER.json` came out the same. The one deliberate change is option order:
JavaScript objects list number-like keys first, while this keeps the file's order, as
upstream's Python does.
