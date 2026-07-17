# Clean installation

CSS Loader for Millennium does not require Decky, an existing CSS Loader
installation, or a pre-created `homebrew` directory.

## Prerequisite

Millennium and the separately released CSS Loader Companion plugin must be
installed. Setup never changes Millennium's plugin configuration or
`themes.activeTheme`.

## First launch

Opening the desktop app performs one idempotent setup operation:

1. Create `%USERPROFILE%\homebrew\themes` recursively.
2. Verify that the complete onedir backend is installed with the desktop app.
3. Remove legacy onefile backend copies from the Windows Startup folder.
4. Register the installed onedir launcher in the current user's Windows login
   autorun key.
5. Start the backend, fetch CSS class translations, and publish a valid empty
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

Previous releases copied a self-extracting onefile backend directly into the
current user's Windows Startup folder. The first launch of the onedir release
stops that process, removes both known legacy Startup filenames, and registers
the installed onedir launcher instead. Companion installation and updates are
owned exclusively by the companion's separate repository.

All theme downloads, profiles, patch values, and runtime configuration remain
in the user's theme library.

## Companion-first installation

The companion can be installed before the desktop app. It waits safely until
the desktop backend creates the user-specific runtime state.
