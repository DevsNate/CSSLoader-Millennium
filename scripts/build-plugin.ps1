param(
  [switch]$CleanInstall
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginRoot = Join-Path $repoRoot "plugins\millennium"

Push-Location $pluginRoot
try {
  if ($CleanInstall -or -not (Test-Path -LiteralPath "node_modules" -PathType Container)) {
    npm ci
    if ($LASTEXITCODE -ne 0) {
      throw "npm ci failed with exit code $LASTEXITCODE"
    }
  }

  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Millennium companion build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$artifact = Join-Path $pluginRoot ".millennium\Dist\index.js"
if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
  throw "Companion build completed without producing $artifact"
}

Write-Output "Companion: $artifact"
