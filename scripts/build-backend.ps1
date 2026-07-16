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

$stream = [System.IO.File]::OpenRead($artifact)
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
Write-Output "Backend: $artifact"
Write-Output "SHA256: $hash"
