[CmdletBinding()]
param(
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'

$ExtensionRoot = Split-Path -Parent $PSScriptRoot
$ManifestPath = Join-Path $ExtensionRoot 'manifest.json'

if (-not (Test-Path -LiteralPath $ManifestPath)) {
  Write-Error "Could not find manifest.json in $ExtensionRoot"
  exit 1
}

$clipboardCopied = $false
try {
  Set-Clipboard -Value $ExtensionRoot
  $clipboardCopied = $true
} catch {
  $clipboardCopied = $false
}

$candidatePaths = @(
  (Join-Path $env:LOCALAPPDATA 'Vivaldi\Application\vivaldi.exe'),
  'C:\Program Files\Vivaldi\Application\vivaldi.exe',
  'C:\Program Files (x86)\Vivaldi\Application\vivaldi.exe'
)

$vivaldiExe = $null
foreach ($candidate in $candidatePaths) {
  if ($candidate -and (Test-Path -LiteralPath $candidate)) {
    $vivaldiExe = $candidate
    break
  }
}

if (-not $vivaldiExe) {
  $cmd = Get-Command vivaldi -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    $vivaldiExe = $cmd.Source
  }
}

Write-Host ''
Write-Host '=== DarkExtension — Vivaldi Quick Setup ===' -ForegroundColor Cyan
Write-Host "Extension folder : $ExtensionRoot"
if ($clipboardCopied) {
  Write-Host 'Clipboard        : Copied extension path (press Ctrl+V when choosing folder)' -ForegroundColor Green
} else {
  Write-Host 'Clipboard        : Unavailable (copy the folder path above manually)' -ForegroundColor Yellow
}
if ($vivaldiExe) {
  Write-Host "Vivaldi found    : $vivaldiExe" -ForegroundColor Green
} else {
  Write-Host 'Vivaldi found    : Not detected in standard paths (open vivaldi://extensions manually)' -ForegroundColor Yellow
}

if (-not $NoLaunch) {
  try {
    Start-Process explorer.exe -ArgumentList "/select,`"$ExtensionRoot`""
  } catch {
    Write-Warning "Could not open Windows Explorer: $($_.Exception.Message)"
  }

  if ($vivaldiExe) {
    try {
      Start-Process -FilePath $vivaldiExe -ArgumentList 'vivaldi://extensions'
    } catch {
      Write-Warning "Could not launch Vivaldi automatically: $($_.Exception.Message)"
    }
  }
}

Write-Host ''
Write-Host '4 Quick Steps in Vivaldi:' -ForegroundColor Cyan
Write-Host '  1. Open vivaldi://extensions and toggle "Developer mode" ON (top-right).'
Write-Host '  2. Drag the highlighted "darkextension" folder onto the extensions page (or click "Load unpacked" -> Ctrl+V -> Enter).'
Write-Host '  3. Click the Extensions puzzle icon in the Address Bar -> right-click DarkExtension -> uncheck "Hide Button" so it stays pinned.'
Write-Host '  4. Open vivaldi://settings/appearance/, set Website Appearance to Dark, and keep "Force a Dark Theme on All Websites" OFF (no double-darkening).'
Write-Host ''
Write-Host 'Tip: Click the Side Panel icon inside DarkExtension (or check Options -> Vivaldi Setup) to dock DarkExtension permanently in Vivaldi''s Panel bar.'
Write-Host ''
