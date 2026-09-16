# Keep the bot running with pm2 and bring it back after Windows restarts.
# Run once, AFTER you have linked WhatsApp with `npm start` (QR scan).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    npm install -g pm2
}

Push-Location $root
try {
    pm2 delete whatsapp-persona-bot 2>$null
    pm2 start ecosystem.config.cjs
    pm2 save
} finally {
    Pop-Location
}

$pm2 = (Get-Command pm2).Source
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -Command `"Start-Sleep 60; & '$pm2' resurrect`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0
Register-ScheduledTask -TaskName 'WhatsApp Persona Bot' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host 'Done. The bot runs under pm2 and starts 60s after you log in (giving Ollama time to start).'
Write-Host 'Logs: pm2 logs whatsapp-persona-bot   Stop: pm2 stop whatsapp-persona-bot'
Write-Host 'Tip: turn off sleep (Settings > System > Power) so replies keep flowing.'
