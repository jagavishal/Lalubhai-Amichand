<#
  One-time setup on the eSSL PC. Run in an elevated PowerShell from this folder:
    powershell -ExecutionPolicy Bypass -File .\Install-Task.ps1

  - creates essl-sync.config.json from the example if it is missing
  - generates the shared sync key if it is blank (put the same value in the
    ERP's .env.local as BIOMETRIC_SYNC_KEY)
  - registers the "ERP eSSL Attendance Sync" task, every 5 minutes, as SYSTEM
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgPath = Join-Path $here 'essl-sync.config.json'
$script = Join-Path $here 'essl-sync.ps1'

if (-not (Test-Path $cfgPath)) {
  Copy-Item (Join-Path $here 'essl-sync.config.example.json') $cfgPath
  Write-Host "Created $cfgPath - fill in sqlPassword, then run this again."
  notepad $cfgPath
  exit 0
}

$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
if (-not $cfg.syncKey) {
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $cfg.syncKey = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $cfg | ConvertTo-Json | Set-Content $cfgPath -Encoding UTF8
}
Write-Host "`nSync key (set BIOMETRIC_SYNC_KEY to this on the ERP server):`n  $($cfg.syncKey)`n"

# The config holds the SQL password: only Administrators and SYSTEM may read it.
icacls $cfgPath /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F' | Out-Null

$name = 'ERP eSSL Attendance Sync'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Force | Out-Null
Write-Host "Scheduled task '$name' registered (every 5 minutes). Log: $(Join-Path $here 'essl-sync.log')"
