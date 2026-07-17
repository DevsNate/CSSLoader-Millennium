$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

$rootPackage = Get-Content -Raw (Join-Path $repoRoot "package.json") | ConvertFrom-Json
$desktopPackage = Get-Content -Raw (Join-Path $repoRoot "apps\desktop\package.json") | ConvertFrom-Json
$companionPackage = Get-Content -Raw (Join-Path $repoRoot "plugins\millennium\package.json") | ConvertFrom-Json
$companionManifest = Get-Content -Raw (Join-Path $repoRoot "plugins\millennium\plugin.json") | ConvertFrom-Json
$cargoManifest = Get-Content -Raw (Join-Path $repoRoot "apps\desktop\src-tauri\Cargo.toml")
$generatedThemeSource = Get-Content -Raw (Join-Path $repoRoot "runtime\backend\css_millennium.py")

$cargoVersionMatch = [regex]::Match($cargoManifest, '(?m)^version\s*=\s*"([^"]+)"')
$themeVersionMatch = [regex]::Match($generatedThemeSource, '(?m)^\s*"version":\s*"([^"]+)",\s*$')
if (-not $cargoVersionMatch.Success -or -not $themeVersionMatch.Success) {
  throw "Could not read every component version"
}

$versions = [ordered]@{
  root = $rootPackage.version
  desktop = $desktopPackage.version
  cargo = $cargoVersionMatch.Groups[1].Value
  companionPackage = $companionPackage.version
  companionManifest = $companionManifest.version
  generatedTheme = $themeVersionMatch.Groups[1].Value
}

$expected = $versions.root
$packagingVersion = if (($expected -split '\.').Count -eq 2) { "$expected.0" } else { $expected }
$expectedVersions = @{
  root = $expected
  desktop = $packagingVersion
  cargo = $packagingVersion
  companionPackage = $expected
  companionManifest = $expected
  generatedTheme = $expected
}
$mismatches = @($versions.GetEnumerator() | Where-Object { $_.Value -ne $expectedVersions[$_.Key] })
if ($mismatches.Count -gt 0) {
  $details = ($versions.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ", "
  throw "CSS Loader component versions are not synchronized: $details"
}

Write-Output "CSS Loader release version is $expected (desktop packaging version $packagingVersion)"
