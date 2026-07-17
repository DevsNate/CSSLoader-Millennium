param(
  [string]$BackendPath = "..\..\runtime\backend\dist\CSS Loader for Millennium Backend"
)

$projectRoot = Split-Path -Parent $PSScriptRoot

function Resolve-ProjectPath([string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $projectRoot $PathValue))
}

$source = Resolve-ProjectPath $BackendPath
$resourceDirectory = Join-Path $projectRoot "src-tauri\resources"
$destination = Join-Path $resourceDirectory "css-loader-backend"
$legacyDestination = Join-Path $resourceDirectory "CSS Loader for Millennium Backend.exe"
$pluginDestination = Join-Path $resourceDirectory "css-loader-companion"
$legacyBackendDestination = Join-Path $resourceDirectory "CssLoader-Standalone-Headless.exe"
$legacyPluginDestination = Join-Path $resourceDirectory "css-loader-runtime"

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
  throw "Millennium backend was not found at $source"
}
$sourceLauncher = Join-Path $source "CSS Loader for Millennium Backend.exe"
if (-not (Test-Path -LiteralPath $sourceLauncher -PathType Leaf)) {
  throw "Millennium backend launcher was not found at $sourceLauncher"
}

New-Item -ItemType Directory -Path $resourceDirectory -Force | Out-Null

if (Test-Path -LiteralPath $legacyBackendDestination -PathType Leaf) {
  Remove-Item -LiteralPath $legacyBackendDestination -Force
}
if (Test-Path -LiteralPath $legacyDestination -PathType Leaf) {
  Remove-Item -LiteralPath $legacyDestination -Force
}
if (Test-Path -LiteralPath $destination -PathType Container) {
  Remove-Item -LiteralPath $destination -Recurse -Force
}
if (Test-Path -LiteralPath $legacyPluginDestination -PathType Container) {
  Remove-Item -LiteralPath $legacyPluginDestination -Recurse -Force
}
if (Test-Path -LiteralPath $pluginDestination -PathType Container) {
  Remove-Item -LiteralPath $pluginDestination -Recurse -Force
}

Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force

$installedLauncher = Join-Path $destination "CSS Loader for Millennium Backend.exe"
$stream = [System.IO.File]::OpenRead($installedLauncher)
try {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $sha256.ComputeHash($stream)
  } finally {
    $sha256.Dispose()
  }
} finally {
  $stream.Dispose()
}

$hash = -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
Write-Output "Bundled backend directory: $destination"
Write-Output "Launcher SHA256: $hash"
