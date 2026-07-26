param(
  [string]$SourcePath = "..\tacticusplanner\src\assets\images\portraits\resized",
  [string]$DestinationPath = ".\img",
  [string]$PortraitMapPath = ".\data\static\portrait-map.json",
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

$portraitMap = @{}
if (Test-Path -Path $PortraitMapPath) {
  $rawMap = Get-Content -Path $PortraitMapPath -Raw
  if ($rawMap) {
    $parsedMap = $rawMap | ConvertFrom-Json
    if ($parsedMap) {
      $parsedMap.PSObject.Properties | ForEach-Object {
        $portraitMap[[string]$_.Name] = [string]$_.Value
      }
    }
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
$resolvedCount = 0
$missingSources = @()
$sourceFilesByName = @{}
$sourceFilesByStem = @{}

foreach ($pattern in $extensions) {
  $files = Get-ChildItem -Path $resolvedSource.Path -Filter $pattern -File -ErrorAction SilentlyContinue
  foreach ($file in $files) {
    $sourceFilesByName[[string]$file.Name] = $file
    $stem = [System.IO.Path]::GetFileNameWithoutExtension([string]$file.Name).ToLowerInvariant()
    if (-not $sourceFilesByStem.ContainsKey($stem)) {
      $sourceFilesByStem[$stem] = $file
      continue
    }

    $existingFile = $sourceFilesByStem[$stem]
    $existingExt = [System.IO.Path]::GetExtension([string]$existingFile.Name).ToLowerInvariant()
    $newExt = [System.IO.Path]::GetExtension([string]$file.Name).ToLowerInvariant()
    $existingPriority = if ($extensionPriority.ContainsKey($existingExt)) { [int]$extensionPriority[$existingExt] } else { 999 }
    $newPriority = if ($extensionPriority.ContainsKey($newExt)) { [int]$extensionPriority[$newExt] } else { 999 }
    if ($newPriority -lt $existingPriority) {
      $sourceFilesByStem[$stem] = $file
    }
  }
}

foreach ($unitId in $portraitMap.Keys) {
  $mappedImage = [string]$portraitMap[$unitId]
  if ([string]::IsNullOrWhiteSpace($mappedImage) -or $mappedImage -eq 'unknown') {
    continue
  }

  $sourceFile = $null
  if ($sourceFilesByName.ContainsKey($mappedImage)) {
    $sourceFile = $sourceFilesByName[$mappedImage]
  } else {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($mappedImage).ToLowerInvariant()
    if ($sourceFilesByStem.ContainsKey($stem)) {
      $sourceFile = $sourceFilesByStem[$stem]
    }
  }

  if (-not $sourceFile) {
    $missingSources += "$unitId -> $mappedImage"
    continue
  }

  $extension = [System.IO.Path]::GetExtension([string]$sourceFile.Name)
  $destinationFileName = "$unitId$extension"
  Copy-Item -Path $sourceFile.FullName -Destination (Join-Path $DestinationPath $destinationFileName) -Force
  $resolvedCount++
  $copiedCount++
}

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
Write-Host "Mapped from portrait-map: $resolvedCount"
Write-Host "Image manifest written to: $ImageManifestPath"

if ($missingSources.Count -gt 0) {
  Write-Host "Portrait map entries with missing source files ($($missingSources.Count)):" -ForegroundColor Yellow
  $missingSources | Sort-Object | ForEach-Object { Write-Host "  $_" }
}