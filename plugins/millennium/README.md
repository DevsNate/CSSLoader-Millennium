<div align="center">
  <h1>CSS Loader Companion for Millennium</h1>
  <p><strong>The official Millennium plugin for CSS Loader for Millennium.</strong></p>
  <p>
    <a href="https://github.com/DevsNate/css-loader-for-millennium"><img alt="Desktop app" src="https://img.shields.io/badge/desktop%20app-CSS%20Loader%20for%20Millennium-0078D4" /></a>
    <a href="https://github.com/SteamClientHomebrew/Millennium"><img alt="Runtime: Millennium" src="https://img.shields.io/badge/runtime-Millennium-171A21" /></a>
    <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" /></a>
  </p>
</div>

CSS Loader Companion connects the CSS Loader desktop app to Steam. It loads the
last generated CSS at Millennium startup, layers it over the selected
Millennium theme, and keeps Big Picture and Steam's isolated side-menu views in
sync.

> [!IMPORTANT]
> This plugin is one component of
> [CSS Loader for Millennium](https://github.com/DevsNate/css-loader-for-millennium).
> For a new installation, use the complete desktop installer. It creates the
> theme library, installs the backend, installs this companion, and generates
> the local CSS asset host automatically.

## What it does

- Loads generated CSS as part of Millennium, before Steam's interface becomes
  visible.
- Keeps the user's selected Millennium theme active and places CSS Loader last
  in the cascade.
- Synchronizes Desktop, Big Picture, Quick Access, Main Menu, and notification
  documents.
- Uses Millennium's in-process APIs; it does not require Steam `-dev` mode, an
  external CDP port, or `.cef-enable-remote-debugging`.
- Continues applying the last compiled profile while the desktop app and
  backend are closed.

## Installation

Download the latest MSI from
[CSS Loader for Millennium Releases](https://github.com/DevsNate/css-loader-for-millennium/releases/latest).
The complete installer configures this plugin automatically and preserves the
currently selected Millennium theme.

If this companion is installed from Millennium first, its panel will wait for
the desktop app. Opening the complete app finishes setup and generates the
user-specific CSS files.

## Development

Requirements: Node.js 20+ and a working Millennium development environment.

```powershell
npm ci
npm run build
```

The production frontend is written to `.millennium/Dist/index.js`.

## Related project

The desktop manager, CSS Loader-compatible backend, installer, and parity tests
live in
[DevsNate/css-loader-for-millennium](https://github.com/DevsNate/css-loader-for-millennium).

## License

Distributed under the [GNU General Public License v3.0](LICENSE).
