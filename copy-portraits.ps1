param(
  [string]$SourcePath = "..\tacticusplanner\src\assets\images\portraits\resized",
  [string]$DestinationPath = ".\img",
  [string]$RenameMapPath = ".\portrait-rename-map.json",
  [string]$ManifestPath = ".\img\unit-portrait-map.json"
)

$ErrorActionPreference = "Stop"

$resolvedSource = Resolve-Path -Path $SourcePath -ErrorAction SilentlyContinue

if (-not $resolvedSource) {
  Write-Error "Source folder not found: $SourcePath"
  exit 1
}

if (-not (Test-Path -Path $DestinationPath)) {
  New-Item -ItemType Directory -Path $DestinationPath | Out-Null
}

# Clean destination image files on every run to avoid stale/ghost portraits.
$destinationImageExtensions = @('.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg')
Get-ChildItem -Path $DestinationPath -File -ErrorAction SilentlyContinue |
  Where-Object { $destinationImageExtensions -contains $_.Extension.ToLowerInvariant() } |
  ForEach-Object { Remove-Item -Path $_.FullName -Force }

$renameMap = @{}
if (Test-Path -Path $RenameMapPath) {
  $rawMap = Get-Content -Path $RenameMapPath -Raw
  if ($rawMap) {
    $parsedMap = $rawMap | ConvertFrom-Json
    if ($parsedMap) {
      $parsedMap.PSObject.Properties | ForEach-Object {
        $renameMap[$_.Name] = [string]$_.Value
      }
    }
  }
}

$extensions = @("*.png", "*.jpg", "*.jpeg", "*.webp", "*.gif", "*.svg")
$copiedCount = 0
$mappedCount = 0
$unmapped = @()
$unitPortraitMap = @{}

foreach ($pattern in $extensions) {
  $files = Get-ChildItem -Path $resolvedSource.Path -Filter $pattern -File -ErrorAction SilentlyContinue
  foreach ($file in $files) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $mappedUnitId = $null

    if ($renameMap.ContainsKey($file.Name)) {
      $mappedUnitId = [string]$renameMap[$file.Name]
    } elseif ($renameMap.ContainsKey($baseName)) {
      $mappedUnitId = [string]$renameMap[$baseName]
    }

    if ([string]::IsNullOrWhiteSpace($mappedUnitId)) {
      $unmapped += $file.Name
    } else {
      # Map value should be the exact unitId from battle data, e.g. ultraTitus.
      $destinationFileName = "$mappedUnitId$($file.Extension.ToLowerInvariant())"
      $unitPortraitMap[$mappedUnitId] = $destinationFileName
      $unitPortraitMap[$mappedUnitId.ToLowerInvariant()] = $destinationFileName
      $mappedCount++

      Copy-Item -Path $file.FullName -Destination (Join-Path $DestinationPath $destinationFileName) -Force
      $copiedCount++
    }
  }
}

if (-not (Test-Path -Path (Split-Path -Parent $ManifestPath))) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $ManifestPath) | Out-Null
}

$manifestJson = $unitPortraitMap | ConvertTo-Json -Depth 3
Set-Content -Path $ManifestPath -Value $manifestJson

Write-Host "Copied mapped portraits: $copiedCount"
Write-Host "Mapped and renamed: $mappedCount"
Write-Host "Manifest written to: $ManifestPath"

if ($unmapped.Count -gt 0) {
  Write-Host "Unmapped files ($($unmapped.Count)) - add entries to ${RenameMapPath}:" -ForegroundColor Yellow
  $unmapped | Sort-Object | ForEach-Object { Write-Host "  $_" }
}