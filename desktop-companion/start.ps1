param([switch]$OpenSettings)
$ErrorActionPreference = 'Stop'
$companionDirectory = Join-Path $env:LOCALAPPDATA 'RomioCompanion'
$controlPath = Join-Path $companionDirectory 'control.json'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$nodeMajor = & $nodePath -p "process.versions.node.split('.')[0]"
if ($nodeMajor -ne '22') { throw 'Install Node.js 22 before starting the companion.' }
New-Item -ItemType Directory -Path $companionDirectory -Force | Out-Null
$running = $false
if (Test-Path -LiteralPath $controlPath) {
  $control = Get-Content -Raw -LiteralPath $controlPath | ConvertFrom-Json
  $existing = Get-Process -Id $control.pid -ErrorAction SilentlyContinue
  if ($existing -and $existing.Path -eq $nodePath) {
    try {
      $null = Invoke-RestMethod -Uri 'http://127.0.0.1:43821/v1/status' -Headers @{ Origin = 'http://127.0.0.1:43821'; Authorization = 'Bearer ' + ([Uri]$control.url).Fragment.TrimStart('#') } -TimeoutSec 3
      $running = $true
    } catch { $running = $false }
  }
}
if (-not $running) {
  $mainPath = Join-Path $PSScriptRoot 'src\main.mjs'
  $env:ROMIO_COMPANION_HOME = $companionDirectory
  $helper = Start-Process -FilePath $nodePath -ArgumentList @('"' + $mainPath + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $companionDirectory 'runtime.log') -RedirectStandardError (Join-Path $companionDirectory 'errors.log')
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 200
    if (Test-Path -LiteralPath $controlPath) { $control = Get-Content -Raw -LiteralPath $controlPath | ConvertFrom-Json; if ($control.pid -eq $helper.Id) { $running = $true; break } }
    $helper.Refresh()
    if ($helper.HasExited) { break }
  } while ([DateTime]::UtcNow -lt $deadline)
  if (-not $running) { throw 'The companion could not start. Check whether another app uses local port 43821.' }
}
Write-Output 'Romio companion is running locally. This window can be closed.'
if ($OpenSettings) {
  # -OpenSettings is an explicit request for an interactive browser window.
  Start-Process -FilePath $control.url | Out-Null
}
