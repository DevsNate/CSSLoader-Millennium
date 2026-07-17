<div align="center">
  <img src="docs/assets/css-loader-wordmark.svg" alt="CSS Loader" width="520" />
  <h1>CSS Loader for Millennium</h1>
  <p><strong>Make CSS Loader work with Millennium's normal safe runtime—without<br /><code>-dev</code> mode or an external CDP debugging flag.</strong></p>
  <p>
    <a href="https://www.microsoft.com/windows"><img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows" /></a>
    <a href="https://github.com/SteamClientHomebrew/Millennium"><img alt="Runtime: Millennium" src="https://img.shields.io/badge/runtime-Millennium-171A21" /></a>
    <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" /></a>
    <a href="https://github.com/DevsNate/CSSLoader-Millennium/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DevsNate/CSSLoader-Millennium/actions/workflows/ci.yml/badge.svg" /></a>
  </p>
</div>

**CSS Loader itself—not its themes—is incompatible with Millennium's normal
runtime.** CSS Loader's Windows standalone backend expects an externally
reachable Chrome DevTools Protocol (CDP) endpoint for injecting styles into
Steam. It creates Steam's `.cef-enable-remote-debugging` marker to enable that
path.

Millennium deliberately removes that deprecated `.cef` marker during its
startup health/safety checks. Its external remote-debugging port is only
exposed when Millennium is launched with `-dev`. Consequently, stock CSS
Loader loses the CDP injection path it requires when Millennium runs normally.

> [!NOTE]
> This is not merely a fix for delayed theme loading. Without a compatibility
> layer, normal Millennium and stock CSS Loader conflict over the external CDP
> mechanism, so CSS Loader does not function correctly in the first place.

## Version 1.0

Version 1.0 is the first stable release of the complete CSS Loader for
Millennium experience: the desktop manager, compatibility backend, direct
runtime publisher, and official Millennium companion.

Its defining advantage is fidelity. Existing CSS Loader themes remain in their
native format and are resolved by CSS Loader's own theme engine. The resulting
styles are delivered directly to Steam without flattening them into converted
Millennium bundles or rewriting valid CSS constructs.

### Main highlights

- Full CSS Loader configuration model: themes, profiles, dependencies, patch
  controls, colors, generated variables, enable state, and cascade order.
- Direct CSS delivery that preserves inline SVG, data URLs, animations, local
  assets, and advanced CSS exactly as authored.
- Desktop, Big Picture, Quick Access, Main Menu, notification, and popup target
  routing through Millennium's supported in-process interfaces.
- Normal Millennium operation with no Steam `-dev` mode, external debugging
  port, or `.cef-enable-remote-debugging` marker.
- Overlay behavior that keeps Fluenty, SpaceTheme, Pebble, or another selected
  Millennium theme active underneath CSS Loader.
- Desktop management for installed themes, profiles, settings, store browsing,
  downloads, updates, and the always-on Windows backend.
- Atomic runtime updates: the companion accepts new state only when its revision
  and content hash match.
- Compatibility regression coverage for real-world themes, including nested
  inline-SVG filters and `/themes_custom` images and fonts.

## How this resolves the conflict

CSS Loader for Millennium replaces the incompatible injection path while
retaining CSS Loader's theme engine and configuration behavior. The backend
still reads existing CSS Loader themes, profiles, dependencies, patch values,
colors, components, class translations, and activation order.

| Stock CSS Loader path | Millennium-compatible replacement |
| --- | --- |
| Creates `.cef-enable-remote-debugging` | Does not create or depend on the marker |
| Requires an externally reachable CDP port | Publishes resolved injects to the Millennium companion |
| Needs Millennium's `-dev` mode to expose that port | Works with Millennium's normal runtime mode |
| Injects every Steam document through external CDP | Uses an in-process Millennium overlay plus its controlled per-plugin CDP proxy for isolated BrowserViews |

The companion layers CSS Loader over whichever Millennium theme is selected.
Desktop and Big Picture are synchronized directly inside Steam; Quick Access,
Main Menu, and notifications use Millennium's isolated per-plugin API because
they live in separate BrowserViews. The runtime does not expose an external CDP
port, recreate the `.cef` marker, require Millennium `-dev` mode, or run a
separate browser bridge.

Eliminating the delayed theming flash is an additional benefit of this design,
not the entire purpose of the project. The compatibility runtime persists the
latest resolved injection state on disk, and its companion starts as part of
Millennium instead of waiting for an external standalone CDP connection.

## Highlights

- Replaces CSS Loader's external CDP injection path with ordered, direct style
  injection inside Millennium.
- Requires neither Millennium `-dev` mode nor `.cef-enable-remote-debugging`.
- Uses existing themes from `~/homebrew/themes`; no manual conversion required.
- Preserves profiles, dependencies, patch options, colors, CSS variables, local
  images/fonts, class translations, and CSS cascade order.
- Defaults to overlay mode, keeping Fluenty, SpaceTheme, Pebble, or another
  selected Millennium theme active beneath CSS Loader.
- Preserves each resolved inject as CSS text instead of flattening it into a
  rewritten bundle.
- Bundles the backend and the separately maintained
  [CSS Loader Companion for Millennium](https://github.com/DevsNate/CSSLoader-Companion-Millennium)
  inside one desktop installer.
- Bootstraps a new `%USERPROFILE%\homebrew\themes` library automatically; Decky
  or a pre-existing CSS Loader installation is not required.
- Republishes direct runtime state when settings or watched CSS files change.
- Keeps Desktop, Big Picture, Quick Access, Main Menu, and notification targets
  separate, matching CSS Loader's real document routing.

## Compatibility baseline

The first full audit used Decky CSS Loader as the source of truth:

| Themes | Controls | Tested states | Target snapshots | Mismatches |
| ---: | ---: | ---: | ---: | ---: |
| 42 | 120 | 595 | 2,380 | **0** |

That matrix covered every selectable option plus component and color states,
with CSS parsed by Steam's Chromium engine. See the full methodology and known
reference warning in [Compatibility verification](docs/verification.md).

## Installation

> [!IMPORTANT]
> This project currently targets **Windows** and requires a working
> [Millennium](https://github.com/SteamClientHomebrew/Millennium) installation.
> The stock CSS Loader standalone backend is not the correct runtime for this
> setup; this Millennium-aware backend and its companion must be installed.

1. Install Millennium and start Steam once so Millennium creates its config.
2. Download and install the latest MSI from this repository's Releases page.
3. Open **CSS Loader for Millennium**. First-run setup creates the theme library,
   installs the backend and companion, and publishes a valid empty state.
4. Leave your preferred Millennium theme selected; CSS Loader is layered over it.
5. Restart Steam once, then manage themes, profiles, and every patch option from
   the desktop app.

The installer places the backend in the current user's Windows Startup folder,
copies and enables the companion in Steam, and creates
`%USERPROFILE%\homebrew\themes` when it does not exist. The backend publishes
the app's resolved state and the companion applies it inside Steam.

The local `Steam\millennium\themes\CSS Loader` folder is generated uniquely for
each user. It is a runtime-state mailbox, not a separately published Marketplace
theme.
See [Clean installation](docs/clean-installation.md) for the complete first-run
contract and migration behavior.

## Build from source

### Requirements

- Windows 10 or 11
- Python 3.11+
- Node.js 20+
- Rust stable and the Microsoft C++ Build Tools (for the MSI)
- Millennium and Steam for end-to-end testing

```powershell
git clone --recurse-submodules https://github.com/DevsNate/CSSLoader-Millennium.git
cd CSSLoader-Millennium

python -m venv .venv
.\.venv\Scripts\python -m pip install -r runtime/backend/requirements-dev.txt
npm ci --prefix plugins/millennium
npm ci --prefix apps/desktop

npm run verify
npm run build:release
```

The MSI is written beneath
`apps/desktop/src-tauri/target/release/bundle/msi/`. Individual commands are
available for `build:backend`, `build:plugin`, and `sync:desktop`.

## Repository map

| Path | Purpose |
| --- | --- |
| `runtime/backend` | CSS Loader compatibility logic and direct-state publisher |
| `plugins/millennium` | Pinned [CSS Loader Companion for Millennium](https://github.com/DevsNate/CSSLoader-Companion-Millennium) submodule used for MSI builds |
| `apps/desktop` | Tauri theme manager and bundled installer |
| `tools/audit` | Reference capture, parity, and Steam class-map auditing |
| `docs` | Architecture and verification methodology |
| `fixtures/parity` | Policy and location for ignored local audit output |

For the full runtime flow, see [Architecture](docs/architecture.md).

## Status and scope

This is an early Millennium-focused distribution. The verified baseline is
strong, but Steam UI updates can change minified classes and BrowserView
behavior. Reports should include the Steam channel, target view, theme/profile,
and exact option that differs. See [Contributing](CONTRIBUTING.md).

Themes are third-party content and are not bundled here. Each theme remains
under its author's license. This repository is derived from the CSS Loader
runtime and desktop projects; see [Attribution and provenance](NOTICE.md).

## Project repositories

| Repository | Purpose |
| --- | --- |
| [`CSSLoader-Millennium`](https://github.com/DevsNate/CSSLoader-Millennium) | Desktop app, CSS Loader-compatible backend, installer, runtime publisher, and verification |
| [`CSSLoader-Companion-Millennium`](https://github.com/DevsNate/CSSLoader-Companion-Millennium) | Millennium Marketplace plugin that applies resolved CSS Loader injects inside Steam |

## License

Distributed under the [GNU General Public License v3.0](LICENSE).
