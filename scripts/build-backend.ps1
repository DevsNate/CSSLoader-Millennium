param(
  [string]$Python
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $repoRoot "runtime\backend"

if (-not $Python) {
  $venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
  $Python = if (Test-Path -LiteralPath $venvPython -PathType Leaf) { $venvPython } else { "python" }
}

Push-Location $backendRoot
try {
  & $Python -m PyInstaller --noconfirm "CssLoader-Standalone-Headless.spec"
  if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$artifact = Join-Path $backendRoot "dist\CssLoader-Standalone-Headless.exe"
if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
  throw "Backend build completed without producing $artifact"
}

$hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash
Write-Output "Backend: $artifact"
Write-Output "SHA256: $hash"
