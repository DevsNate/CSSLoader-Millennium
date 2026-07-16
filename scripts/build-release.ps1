param(
  [switch]$CleanInstall
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopRoot = Join-Path $repoRoot "apps\desktop"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  $userCargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
  if (Test-Path -LiteralPath (Join-Path $userCargoBin "cargo.exe") -PathType Leaf) {
    $env:PATH = "$userCargoBin;$env:PATH"
  }
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "Rust/Cargo was not found. Install the stable Rust toolchain before building the MSI."
}

& (Join-Path $PSScriptRoot "build-backend.ps1")
& (Join-Path $PSScriptRoot "build-plugin.ps1") -CleanInstall:$CleanInstall
& (Join-Path $PSScriptRoot "sync-desktop.ps1")

Push-Location $desktopRoot
try {
  if ($CleanInstall -or -not (Test-Path -LiteralPath "node_modules" -PathType Container)) {
    npm ci
    if ($LASTEXITCODE -ne 0) {
      throw "Desktop npm install failed with exit code $LASTEXITCODE"
    }
  }

  npm run tauri build
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri release build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
