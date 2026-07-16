<div align="center">
  <img src="docs/assets/css-loader-wordmark.svg" alt="CSS Loader" width="520" />
  <h1>CSS Loader for Millennium</h1>
  <p><strong>Make CSS Loader work with Millennium's normal safe runtime—without<br /><code>-dev</code> mode or an external CDP debugging flag.</strong></p>
  <p>
    <a href="https://www.microsoft.com/windows"><img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows" /></a>
    <a href="https://github.com/SteamClientHomebrew/Millennium"><img alt="Runtime: Millennium" src="https://img.shields.io/badge/runtime-Millennium-171A21" /></a>
    <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" /></a>
    <a href="https://github.com/DevsNate/millennium-css-loader/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DevsNate/millennium-css-loader/actions/workflows/ci.yml/badge.svg" /></a>
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

## How this resolves the conflict

CSS Loader for Millennium replaces the incompatible injection path while
retaining CSS Loader's theme engine and configuration behavior. The backend
still reads existing CSS Loader themes, profiles, dependencies, patch values,
colors, components, class translations, and activation order.

| Stock CSS Loader path | Millennium-compatible replacement |
| --- | --- |
| Creates `.cef-enable-remote-debugging` | Does not create or depend on the marker |
| Requires an externally reachable CDP port | Compiles the selected state into a persistent Millennium theme |
| Needs Millennium's `-dev` mode to expose that port | Works with Millennium's normal runtime mode |
| Injects every Steam document through external CDP | Uses Millennium patches plus its controlled per-plugin CDP proxy for isolated BrowserViews |

Quick Access, Main Menu, and notifications live in separate Steam BrowserViews.
The companion keeps those targets synchronized through Millennium's own
isolated plugin API. It does not expose an external CDP port, recreate the
`.cef` marker, require Millennium `-dev` mode, or run a separate browser bridge.

Eliminating the delayed theming flash is an additional benefit of this design,
not the entire purpose of the project. The compatibility runtime persists the
last compiled configuration as a regular Millennium theme, allowing the main
Steam and Big Picture styles to preload during startup instead of waiting for a
late standalone injection pass.

## Highlights

- Replaces CSS Loader's external CDP injection path with a Millennium-compatible
  generated-theme runtime.
- Requires neither Millennium `-dev` mode nor `.cef-enable-remote-debugging`.
- Uses existing themes from `~/homebrew/themes`; no manual conversion required.
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
> The stock CSS Loader standalone backend is not the correct runtime for this
> setup; this Millennium-aware backend and its companion must be installed.

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
