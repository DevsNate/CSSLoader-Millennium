param(
  [string]$BackendPath = "..\..\runtime\backend\dist\CssLoader-Standalone-Headless.exe",
  [string]$PluginPath = "..\..\plugins\millennium"
)

$projectRoot = Split-Path -Parent $PSScriptRoot

function Resolve-ProjectPath([string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $projectRoot $PathValue))
}

$source = Resolve-ProjectPath $BackendPath
$pluginSource = Resolve-ProjectPath $PluginPath
$resourceDirectory = Join-Path $projectRoot "src-tauri\resources"
$destination = Join-Path $resourceDirectory "CssLoader-Standalone-Headless.exe"
$pluginDestination = Join-Path $resourceDirectory "css-loader-runtime"

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Millennium backend was not found at $source"
}

New-Item -ItemType Directory -Path $resourceDirectory -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force

$pluginFiles = @(
  "plugin.json",
  "backend\main.lua",
  ".millennium\Dist\index.js"
)

$obsoletePluginManifest = Join-Path $pluginDestination "package.json"
if (Test-Path -LiteralPath $obsoletePluginManifest -PathType Leaf) {
  Remove-Item -LiteralPath $obsoletePluginManifest -Force
}
$obsoletePluginSource = Join-Path $pluginDestination "frontend\index.tsx"
if (Test-Path -LiteralPath $obsoletePluginSource -PathType Leaf) {
  Remove-Item -LiteralPath $obsoletePluginSource -Force
}

foreach ($relativePath in $pluginFiles) {
  $pluginFile = Join-Path $pluginSource $relativePath
  if (-not (Test-Path -LiteralPath $pluginFile -PathType Leaf)) {
    throw "Millennium companion plugin file was not found at $pluginFile"
  }

  $targetFile = Join-Path $pluginDestination $relativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $targetFile) -Force | Out-Null
  Copy-Item -LiteralPath $pluginFile -Destination $targetFile -Force
}

$stream = [System.IO.File]::OpenRead($destination)
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
Write-Output "Bundled backend: $destination"
Write-Output "SHA256: $hash"
Write-Output "Bundled companion plugin: $pluginDestination"
