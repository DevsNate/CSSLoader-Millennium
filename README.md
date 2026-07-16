<div align="center">
  <img src="docs/assets/css-loader-wordmark.svg" alt="CSS Loader" width="520" />
  <h1>CSS Loader for Millennium</h1>
  <p><strong>Use existing CSS Loader themes and profiles through Millennium—without the<br />unstyled startup flash from a late standalone injection pass.</strong></p>
  <p>
    <a href="https://www.microsoft.com/windows"><img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows" /></a>
    <a href="https://github.com/SteamClientHomebrew/Millennium"><img alt="Runtime: Millennium" src="https://img.shields.io/badge/runtime-Millennium-171A21" /></a>
    <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" /></a>
    <a href="https://github.com/DevsNate/millennium-css-loader/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DevsNate/millennium-css-loader/actions/workflows/ci.yml/badge.svg" /></a>
  </p>
</div>

CSS Loader for Millennium is a Windows compatibility runtime for the existing
CSS Loader theme ecosystem. It understands the same theme folders, profiles,
dependencies, class translations, patch controls, colors, and component
options, then compiles the selected result into one persistent Millennium theme
named **CSS Loader**.

## Why this exists

Traditional standalone injection starts after Steam's web UI appears. Even
when it works, that timing can expose the unstyled client for a second or two.
This project writes the last compiled configuration as a regular Millennium
theme, allowing the main Steam and Big Picture styles to preload during startup.

Quick Access, Main Menu, and notifications live in separate Steam BrowserViews.
A small companion plugin keeps those views synchronized through Millennium's
own isolated plugin API—without an external CDP port, Steam developer mode, or
a separate bridge process.

## Highlights

- Uses existing themes from `~/homebrew/themes`; no theme conversion required.
- Preserves profiles, dependencies, patch options, colors, CSS variables, local
  images/fonts, class translations, and CSS cascade order.
- Produces a single visible Millennium theme: **CSS Loader**.
- Bundles the backend and companion inside one desktop installer.
- Reloads the generated theme when settings or watched CSS files change.
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

1. Install Millennium and start Steam once so Millennium creates its config.
2. Download the latest MSI from this repository's Releases page.
3. Open **CSS Loader for Millennium** and choose **Install Millennium Backend**.
4. In Millennium, select the theme named **CSS Loader** if it is not already
   active, then restart Steam once.
5. Manage themes, profiles, and every patch option from the desktop app.

The installer places the backend in the current user's Windows Startup folder,
copies the companion to Steam's Millennium plugin directory, and enables the
plugin. Your installed themes remain in their existing CSS Loader directory.

## Build from source

### Requirements

- Windows 10 or 11
- Python 3.11+
- Node.js 20+
- Rust stable and the Microsoft C++ Build Tools (for the MSI)
- Millennium and Steam for end-to-end testing

```powershell
git clone https://github.com/DevsNate/millennium-css-loader.git
cd millennium-css-loader

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
| `runtime/backend` | CSS Loader compatibility logic and generated-theme compiler |
| `plugins/millennium` | Isolated BrowserView live-sync companion |
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

## License

Distributed under the [GNU General Public License v3.0](LICENSE).
