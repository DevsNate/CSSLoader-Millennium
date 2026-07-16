$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopRoot = Join-Path $repoRoot "apps\desktop"
$syncScript = Join-Path $desktopRoot "scripts\sync-backend.ps1"
$backend = Join-Path $repoRoot "runtime\backend\dist\CSS Loader for Millennium Backend.exe"
$plugin = Join-Path $repoRoot "plugins\millennium"

& $syncScript -BackendPath $backend -PluginPath $plugin
