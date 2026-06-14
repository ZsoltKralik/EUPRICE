# Registers (or re-registers) the monthly EUPRICE refresh as a Windows
# Scheduled Task. Run once. Re-run to update the schedule (/f overwrites).
#
#   powershell -ExecutionPolicy Bypass -File scripts\register_refresh_task.ps1
#
# Runs on day 1 of each month at 03:00, as the current user, only while logged
# on (no stored credentials / admin needed). To remove:
#   schtasks /delete /tn "EUPRICE Monthly Refresh" /f

$taskName = "EUPRICE Monthly Refresh"
$wrapper  = "C:\CLAUDE\EUPRICE\scripts\refresh_monthly.ps1"
$action   = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$wrapper`""

schtasks /create /tn $taskName /tr $action /sc monthly /d 1 /st 03:00 /f

Write-Host ""
Write-Host "Registered. Inspect with:  schtasks /query /tn `"$taskName`" /v /fo LIST"
Write-Host "Run on demand with:        schtasks /run /tn `"$taskName`""
