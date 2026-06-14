# EUPRICE monthly refresh — invoked by the Windows Task Scheduler entry
# "EUPRICE Monthly Refresh" (see scripts/register_refresh_task.ps1).
#
# Runs the full pipeline (scrape -> quality-gate -> archive -> export -> commit
# -> push) and tees all output to a dated log file so an unattended run is
# debuggable. The quality gate inside refresh_all.py aborts the commit if the
# pack-quality audit finds a fatal (wrong-product/size) flag, so a bad scrape
# never gets published automatically.

$ErrorActionPreference = "Continue"
$repo = "C:\CLAUDE\EUPRICE"
$logDir = Join-Path $repo "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir ("refresh-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"
Set-Location $repo

"=== EUPRICE monthly refresh $(Get-Date -Format o) ===" | Tee-Object -FilePath $log
& python scripts/refresh_all.py *>&1 | Tee-Object -FilePath $log -Append
"=== exit code: $LASTEXITCODE ===" | Tee-Object -FilePath $log -Append
