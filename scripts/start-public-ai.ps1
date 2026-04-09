param(
  [string]$AllowedOrigins = "https://carai.sasha20010483.workers.dev,https://carai2.sasha20010483.workers.dev",
  [string]$RateLimitPerMinute = "40"
)

$projectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Starting CodexCar public AI backend..." -ForegroundColor Cyan
Write-Host "Allowed origins: $AllowedOrigins" -ForegroundColor DarkCyan
Write-Host "Rate limit per minute: $RateLimitPerMinute" -ForegroundColor DarkCyan

$serverCommand = @"
`$env:AI_ALLOWED_ORIGINS='$AllowedOrigins'
`$env:AI_RATE_LIMIT_PER_MINUTE='$RateLimitPerMinute'
Set-Location '$projectRoot'
npm run ai:server
"@

$tunnelCommand = @"
Set-Location '$projectRoot'
npm run ai:tunnel:quick
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $serverCommand
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", $tunnelCommand

Write-Host ""
Write-Host "Two PowerShell windows were opened:" -ForegroundColor Green
Write-Host "1. Local AI backend" -ForegroundColor Green
Write-Host "2. Cloudflare quick tunnel" -ForegroundColor Green
Write-Host ""
Write-Host "Copy the trycloudflare.com URL from the tunnel window" -ForegroundColor Yellow
Write-Host "and paste it into CodexCar -> Owner -> Local AI -> Backend URL." -ForegroundColor Yellow
