param(
  [string]$SourcePath = "..\tacticusplanner\src\assets\images\portraits\resized",
  [string]$DestinationPath = ".\img",
  [string]$RenameMapPath = ".\data\static\portrait-rename-map.json",
  [string]$ManifestPath = ".\data\static\unit-portrait-map.json",
  [string]$ImageManifestPath = ".\data\static\image-manifest.json"
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

# Secondary lookup by stem (filename without extension), so key extension can differ from source extension.
$renameMapByStem = @{}
foreach ($key in $renameMap.Keys) {
  $stem = [System.IO.Path]::GetFileNameWithoutExtension([string]$key).ToLowerInvariant()
  if (-not $renameMapByStem.ContainsKey($stem)) {
    $renameMapByStem[$stem] = [string]$key
  }
}

$extensions = @("*.png", "*.jpg", "*.jpeg", "*.webp", "*.gif", "*.svg")
$extensionPriority = @{
  '.png' = 1
  '.jpg' = 2
  '.jpeg' = 2
  '.webp' = 3
  '.gif' = 4
  '.svg' = 5
}
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
    } else {
      $normalizedStem = $baseName.ToLowerInvariant()
      if ($renameMapByStem.ContainsKey($normalizedStem)) {
        $mappedUnitId = [string]$renameMap[$renameMapByStem[$normalizedStem]]
      }
    }

    if ([string]::IsNullOrWhiteSpace($mappedUnitId) -or $mappedUnitId -eq 'unknown') {
      $unmapped += $file.Name
    } else {
      # Map value should be the exact unitId from battle data, e.g. ultraTitus.
      $extension = $file.Extension.ToLowerInvariant()
      $destinationFileName = "$mappedUnitId$extension"
      $existingDestination = [string]$unitPortraitMap[$mappedUnitId]

      if (-not [string]::IsNullOrWhiteSpace($existingDestination)) {
        $existingExt = [System.IO.Path]::GetExtension($existingDestination).ToLowerInvariant()
        $existingPriority = if ($extensionPriority.ContainsKey($existingExt)) { [int]$extensionPriority[$existingExt] } else { 999 }
        $currentPriority = if ($extensionPriority.ContainsKey($extension)) { [int]$extensionPriority[$extension] } else { 999 }

        if ($existingPriority -le $currentPriority) {
          continue
        }
      }

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

$sourceImageManifest = @()
foreach ($pattern in $extensions) {
  $files = Get-ChildItem -Path $resolvedSource.Path -Filter $pattern -File -ErrorAction SilentlyContinue
  foreach ($file in $files) {
    $sourceImageManifest += [string]$file.Name
  }
}

$sourceImageManifest = $sourceImageManifest |
  Sort-Object -Unique

if (-not (Test-Path -Path (Split-Path -Parent $ImageManifestPath))) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $ImageManifestPath) | Out-Null
}

Set-Content -Path $ImageManifestPath -Value ($sourceImageManifest | ConvertTo-Json)

Write-Host "Copied mapped portraits: $copiedCount"
Write-Host "Mapped and renamed: $mappedCount"
Write-Host "Manifest written to: $ManifestPath"
Write-Host "Image manifest written to: $ImageManifestPath"

if ($unmapped.Count -gt 0) {
  Write-Host "Unmapped files ($($unmapped.Count)) - add entries to ${RenameMapPath}:" -ForegroundColor Yellow
  $unmapped | Sort-Object | ForEach-Object { Write-Host "  $_" }
}