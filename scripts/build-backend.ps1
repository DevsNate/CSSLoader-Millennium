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
  & $Python -m PyInstaller --noconfirm --clean "CSS-Loader-for-Millennium-Backend.spec"
  if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$artifact = Join-Path $backendRoot "dist\CSS Loader for Millennium Backend"
$launcher = Join-Path $artifact "CSS Loader for Millennium Backend.exe"
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  throw "Backend build completed without producing $launcher"
}

$stream = [System.IO.File]::OpenRead($launcher)
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
$files = Get-ChildItem -LiteralPath $artifact -Recurse -File
Write-Output "Backend directory: $artifact"
Write-Output "Launcher: $launcher"
Write-Output "Launcher SHA256: $hash"
Write-Output "Files: $($files.Count)"
Write-Output "Installed bytes: $(($files | Measure-Object -Property Length -Sum).Sum)"
