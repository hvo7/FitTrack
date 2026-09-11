param([string]$InstallDirectory = 'C:\Users\henry\AppData\Local\Programs\FitTrack')
$ErrorActionPreference = 'Stop'
function Get-ArchiveHash([string]$LiteralPath) {
  $stream = [IO.File]::OpenRead($LiteralPath)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$targetRoot = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$expectedRoot = 'C:\Users\henry\AppData\Local\Programs\FitTrack'
if ($targetRoot -ne $expectedRoot) { throw 'This updater is restricted to the user-designated FitTrack installation.' }
$executable = Join-Path $targetRoot 'FitTrack.exe'
$archive = Join-Path $targetRoot 'resources\app.asar'
if (!(Test-Path -LiteralPath $executable) -or !(Test-Path -LiteralPath $archive)) { throw 'FitTrack installation is incomplete.' }
$release = Get-Content -LiteralPath (Join-Path $workspaceRoot 'dist\installed-release.json') -Raw | ConvertFrom-Json
$source = [IO.Path]::GetFullPath($release.archive)
if ($source -ne (Join-Path $workspaceRoot 'dist\installed-app.asar')) { throw 'Unexpected release archive path.' }
if ((Get-ArchiveHash $source) -ne $release.sha256) { throw 'Release checksum does not match.' }

# Refuse an update that would silently change the installed account configuration.
Push-Location $workspaceRoot
try {
  $configHash = & node -e "const a=require('@electron/asar'),c=require('crypto');console.log(c.createHash('sha256').update(a.extractFile(process.argv[1],'config.js')).digest('hex'))" $archive
  if ($LASTEXITCODE -ne 0 -or $configHash.Trim() -ne $release.configSha256) { throw 'Installed and workspace configurations differ. Reconcile them before updating.' }
} finally { Pop-Location }

function Get-InstalledProcesses {
  @(Get-Process -Name FitTrack -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable })
}
$running = Get-InstalledProcesses
foreach ($process in $running) { if ($process.MainWindowHandle -ne 0) { [void]$process.CloseMainWindow() } }
$deadline = (Get-Date).AddSeconds(20)
while ((Get-InstalledProcesses).Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
if ((Get-InstalledProcesses).Count -gt 0) { throw 'FitTrack did not exit gracefully. No installed files were changed.' }

$backup = Join-Path $targetRoot ('resources\app.asar.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$staged = Join-Path $targetRoot 'resources\app.asar.pending'
Copy-Item -LiteralPath $archive -Destination $backup
try {
  Copy-Item -LiteralPath $source -Destination $staged -Force
  if ((Get-ArchiveHash $staged) -ne $release.sha256) { throw 'Copied archive checksum does not match.' }
  # Atomically replace only the code archive. Electron binaries and user data stay put.
  [IO.File]::Replace($staged, $archive, $backup)
  if ((Get-ArchiveHash $archive) -ne $release.sha256) { throw 'Installed archive checksum does not match.' }
} catch {
  Copy-Item -LiteralPath $backup -Destination $archive -Force
  throw
}
$receipt = [ordered]@{ executable=$executable; archive=$archive; backup=$backup; build=$release.build; sha256=$release.sha256; installedAt=(Get-Date).ToUniversalTime().ToString('o') }
$receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $targetRoot 'resources\local-update.json') -Encoding UTF8
# This is the user's interactive application, not a background build helper.
Start-Process -FilePath $executable -WorkingDirectory $targetRoot -WindowStyle Normal
$receipt | ConvertTo-Json
