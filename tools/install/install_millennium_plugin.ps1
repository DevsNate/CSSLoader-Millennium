param(
  [string]$SteamPath
)

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$pluginSource = Join-Path $repoRoot "plugins\millennium"
$compiledFrontend = Join-Path $pluginSource ".millennium\Dist\index.js"

if (-not $SteamPath) {
  $currentUserSteam = Get-ItemProperty -LiteralPath "HKCU:\SOFTWARE\Valve\Steam" -ErrorAction SilentlyContinue
  if ($currentUserSteam -and $currentUserSteam.SteamPath) {
    $SteamPath = $currentUserSteam.SteamPath
  } else {
    $SteamPath = (Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\WOW6432Node\Valve\Steam" -ErrorAction Stop).InstallPath
  }
}

if (-not (Test-Path -LiteralPath $compiledFrontend -PathType Leaf)) {
  throw "Build the companion first with npm run build:plugin from the repository root."
}

$pluginTarget = Join-Path $SteamPath "millennium\plugins\css-loader-runtime"
$configPath = Join-Path $SteamPath "millennium\config\config.json"

foreach ($directory in @("backend", ".millennium\Dist")) {
  New-Item -ItemType Directory -Path (Join-Path $pluginTarget $directory) -Force | Out-Null
}

Copy-Item -LiteralPath (Join-Path $pluginSource "plugin.json") -Destination (Join-Path $pluginTarget "plugin.json") -Force
Copy-Item -LiteralPath (Join-Path $pluginSource "backend\main.lua") -Destination (Join-Path $pluginTarget "backend\main.lua") -Force
Copy-Item -LiteralPath $compiledFrontend -Destination (Join-Path $pluginTarget ".millennium\Dist\index.js") -Force

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$activeThemeBefore = $config.themes.activeTheme
if ($config.plugins.enabledPlugins -notcontains "css-loader-runtime") {
  Copy-Item -LiteralPath $configPath -Destination ($configPath + ".css-loader-backup") -Force
  $config.plugins.enabledPlugins = @($config.plugins.enabledPlugins) + "css-loader-runtime"
  if ($config.themes.activeTheme -ne $activeThemeBefore) {
    throw "Refusing to change Millennium's active theme"
  }
  $config | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $configPath -Encoding UTF8
}

Write-Output "Installed and enabled CSS Loader Runtime at $pluginTarget"
Write-Output "Overlay mode preserved the active Millennium theme: $activeThemeBefore"
Write-Output "Restart Steam once to load the companion plugin."
