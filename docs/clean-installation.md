# Clean installation

CSS Loader for Millennium does not require Decky, an existing CSS Loader
installation, or a pre-created `homebrew` directory.

## Prerequisite

Millennium must be installed and Steam must have been started once. That first
Steam run creates Millennium's config file, which CSS Loader updates only to
enable its companion. Setup never changes `themes.activeTheme`.

## First launch

Opening the desktop app performs one idempotent setup operation:

1. Locate Steam from the current-user or machine-wide Windows registry entry.
2. Create `%USERPROFILE%\homebrew\themes` recursively.
3. Copy the bundled backend into the current user's Windows Startup folder.
4. Install **CSS Loader Companion** into Millennium's plugin directory.
5. Enable `css-loader-companion` while preserving the selected Millennium theme.
6. Start the backend, fetch CSS class translations, and publish a valid empty
   direct runtime state when no themes have been installed yet.

The first empty theme library normally contains only:

- `css_translations.json`, the downloaded Steam class translation cache;
- `standalone.log`, the local diagnostic log.

The `STORE` configuration file is created when the user first saves a setting
or profile.

## Runtime output

The backend writes the user's current combination to:

```text
%STEAM%\millennium\themes\CSS Loader
```

This directory is a local mailbox containing `runtime-state.json`, a matching
build report, and a metadata-only `skin.json`. The state contains CSS Loader's
resolved, ordered injects without bundle conversion or asset rewriting. It is
deliberately not distributed as a public Millennium theme.

Local images and fonts continue using CSS Loader's `/themes_custom/...` path.
The backend links that path to the homebrew library when possible and otherwise
mirrors active theme files into the existing custom directory.

Republishing atomically replaces the previous state. The companion only accepts
it when the state and report hashes match.

## Upgrade migration

Versions before 0.2.0 installed the plugin as `css-loader-runtime`. Setup now:

1. installs `css-loader-companion`;
2. replaces the old enabled-plugin entry without touching the active theme;
3. removes the old plugin directory after the new files are in place;
4. retains a one-time `config.json.css-loader-backup` beside Millennium's config.

All theme downloads, profiles, patch values, and runtime configuration remain
in the user's theme library.

## Companion-first installation

If a user installs CSS Loader Companion from Millennium before installing the
desktop app, the plugin waits safely and displays a link to the complete
installer. Opening the desktop app completes setup and creates the user-specific
runtime state.
