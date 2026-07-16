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
6. Start the backend, fetch CSS class translations, and generate a valid empty
   overlay when no themes have been installed yet.

The first empty theme library normally contains only:

- `css_translations.json`, the downloaded Steam class translation cache;
- `standalone.log`, the local diagnostic log.

The `STORE` configuration file is created when the user first saves a setting
or profile.

## Generated output

The backend writes the user's current combination to:

```text
%STEAM%\millennium\themes\CSS Loader
```

This directory is a local asset host. Its bundles, copied images, fonts, build
report, and optional **CSS Loader (Standalone)** selector are generated from the
current user's themes and settings. It is deliberately not distributed as a
public Millennium theme.

Regeneration removes bundles and copied theme assets that are no longer part of
the selected profile. The last valid build remains usable by the companion when
the desktop app and backend are closed.

## Upgrade migration

Versions before 0.2.0 installed the plugin as `css-loader-runtime`. Setup now:

1. installs `css-loader-companion`;
2. replaces the old enabled-plugin entry without touching the active theme;
3. removes the old plugin directory after the new files are in place;
4. retains a one-time `config.json.css-loader-backup` beside Millennium's config.

All theme downloads, profiles, patch values, and generated configuration remain
in the user's theme library.

## Companion-first installation

If a user installs CSS Loader Companion from Millennium before installing the
desktop app, the plugin waits safely and displays a link to the complete
installer. Opening the desktop app completes setup and creates the user-specific
generated output.
