param(
  [switch]$CleanInstall
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $repoRoot "runtime\backend"
$desktopRoot = Join-Path $repoRoot "apps\desktop"
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
$python = if (Test-Path -LiteralPath $venvPython -PathType Leaf) { $venvPython } else { "python" }

& (Join-Path $PSScriptRoot "verify-versions.ps1")

Push-Location $backendRoot
try {
  & $python -m unittest discover -s tests -v
  if ($LASTEXITCODE -ne 0) {
    throw "Runtime tests failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

& $python (Join-Path $repoRoot "tools\audit\audit_steam_classes.py") --help | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Steam class audit could not be imported"
}
& $python (Join-Path $repoRoot "tools\audit\decky_reference_audit.py") --help | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Decky reference audit could not be imported"
}
& $python (Join-Path $repoRoot "tools\audit\millennium_parity_audit.py") --help | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Millennium parity audit could not be imported"
}

Push-Location $desktopRoot
try {
  if ($CleanInstall -or -not (Test-Path -LiteralPath "node_modules" -PathType Container)) {
    npm ci
    if ($LASTEXITCODE -ne 0) {
      throw "Desktop npm install failed with exit code $LASTEXITCODE"
    }
  }

  npm run typecheck
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop typecheck failed with exit code $LASTEXITCODE"
  }

  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop web build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Output "All source verification checks passed."
