$ErrorActionPreference = 'Stop'
$controlPath = Join-Path $env:LOCALAPPDATA 'RomioCompanion\control.json'
if (-not (Test-Path -LiteralPath $controlPath)) { Write-Output 'Romio companion is not running.'; exit }
$control = Get-Content -Raw -LiteralPath $controlPath | ConvertFrom-Json
$controlUrl = [Uri]$control.url
if ($controlUrl.Scheme -ne 'http' -or $controlUrl.Host -ne '127.0.0.1' -or $controlUrl.Port -ne 43821) { throw 'Invalid local companion control address.' }
$null = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:43821/v1/local/stop' -Headers @{ Origin = 'http://127.0.0.1:43821'; Authorization = 'Bearer ' + $controlUrl.Fragment.TrimStart('#') } -ContentType 'application/json' -Body '{}' -TimeoutSec 15
Write-Output 'Romio companion is stopping. Interrupted downloads can be resumed from RomM after restart.'
