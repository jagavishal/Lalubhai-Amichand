<#
  eSSL biometric -> ERP attendance sync.

  Runs on the office PC that hosts the eSSL (eTimeTrackLite) SQL Server.
  Reads every punch of the last few days from the DeviceLogs_<M>_<YYYY>
  tables and posts them to https://laltdoffice.com/api/hr/attendance/biometric.
  The ERP recomputes each day's first (In) and last (Out) punch, so running
  it again, or after a missed run, is always safe.

  Usage (from this folder):
    .\essl-sync.ps1 -Discover     list databases / tables / columns, to check the config
    .\essl-sync.ps1 -DryRun       read punches and show them, send nothing
    .\essl-sync.ps1               one sync (what the scheduled task runs)
    .\essl-sync.ps1 -Days 31      backfill the last 31 days

  Settings live in essl-sync.config.json next to this file (see the
  .example file). Install-Task.ps1 schedules it every 5 minutes.
#>
param(
  [switch]$Discover,
  [switch]$DryRun,
  [int]$Days = 0
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgPath = Join-Path $here 'essl-sync.config.json'
$logPath = Join-Path $here 'essl-sync.log'

function Log([string]$msg) {
  $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $msg
  try {
    if ((Test-Path $logPath) -and (Get-Item $logPath).Length -gt 1MB) {
      Move-Item $logPath "$logPath.old" -Force
    }
    Add-Content -Path $logPath -Value $line
  } catch { }
  Write-Host $line
}

if (-not (Test-Path $cfgPath)) { throw "Missing $cfgPath - copy essl-sync.config.example.json to it and fill it in." }
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$database = if ($cfg.database) { $cfg.database } else { 'etimetracklite1' }

function Connection-String([string]$db) {
  $cs = "Server=$($cfg.sqlServer);Database=$db;Connect Timeout=15;Encrypt=True;TrustServerCertificate=True;"
  if ($cfg.sqlUser) { $cs += "User ID=$($cfg.sqlUser);Password=$($cfg.sqlPassword);" }
  else { $cs += 'Integrated Security=SSPI;' }
  return $cs
}

function Query([string]$sql, [hashtable]$params = @{}, [string]$db = $database) {
  $conn = New-Object System.Data.SqlClient.SqlConnection (Connection-String $db)
  try {
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = 60
    foreach ($k in $params.Keys) { [void]$cmd.Parameters.AddWithValue($k, $params[$k]) }
    $table = New-Object System.Data.DataTable
    $table.Load($cmd.ExecuteReader())
    return ,$table
  } finally { $conn.Close() }
}

function Has-Column([string]$table, [string]$column) {
  $t = Query "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t AND COLUMN_NAME = @c" @{ '@t' = $table; '@c' = $column }
  return $t.Rows.Count -gt 0
}

# ── Discover: show what is there, so the config can be checked ──────────
if ($Discover) {
  Write-Host "`n== Databases on $($cfg.sqlServer) =="
  (Query 'SELECT name FROM sys.databases ORDER BY name' @{} 'master').Rows | ForEach-Object { Write-Host '  ' $_.name }
  Write-Host "`n== DeviceLogs tables in $database =="
  (Query "SELECT name FROM sys.tables WHERE name LIKE 'DeviceLogs%' ORDER BY name").Rows | ForEach-Object { Write-Host '  ' $_.name }
  Write-Host "`n== Employees columns =="
  (Query "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Employees' ORDER BY ORDINAL_POSITION").Rows |
    ForEach-Object { Write-Host '  ' $_.COLUMN_NAME }
  $now = Get-Date
  $tbl = "DeviceLogs_$($now.Month)_$($now.Year)"
  Write-Host "`n== Latest 10 punches in $tbl =="
  try {
    (Query "SELECT TOP 10 UserId, CONVERT(varchar(19), LogDate, 120) AS LogDate, DeviceId FROM [$tbl] ORDER BY LogDate DESC").Rows |
      ForEach-Object { Write-Host ('   {0,-10} {1}  device {2}' -f $_.UserId, $_.LogDate, $_.DeviceId) }
  } catch { Write-Host "   (could not read $tbl : $($_.Exception.Message))" }
  Write-Host "`n== First 10 employees =="
  $codeCol = if (Has-Column 'Employees' 'EmployeeCodeInDevice') { 'EmployeeCodeInDevice' } else { 'EmployeeCode' }
  (Query "SELECT TOP 10 $codeCol AS Code, EmployeeName FROM Employees ORDER BY EmployeeName").Rows |
    ForEach-Object { Write-Host ('   {0,-10} {1}' -f $_.Code, $_.EmployeeName) }
  exit 0
}

# ── Read the window ──────────────────────────────────────────────────────
try {
  $span = if ($Days -gt 0) { $Days } elseif ($cfg.days) { [int]$cfg.days } else { 2 }
  $from = (Get-Date).Date.AddDays(-($span - 1))
  $codeCol = if (Has-Column 'Employees' 'EmployeeCodeInDevice') { 'EmployeeCodeInDevice' } else { 'EmployeeCode' }

  # One DeviceLogs table per month the window touches.
  $months = @()
  $m = Get-Date -Year $from.Year -Month $from.Month -Day 1
  while ($m -le (Get-Date)) { $months += "DeviceLogs_$($m.Month)_$($m.Year)"; $m = $m.AddMonths(1) }

  $punches = New-Object System.Collections.ArrayList
  foreach ($tbl in $months) {
    $exists = Query 'SELECT OBJECT_ID(@t) AS id' @{ '@t' = $tbl }
    if ($exists.Rows[0].id -is [DBNull]) { Log "skip $tbl (not found)"; continue }
    $rows = Query @"
SELECT L.UserId, CONVERT(varchar(19), L.LogDate, 120) AS LogDate, E.EmployeeName
  FROM [$tbl] L
  LEFT JOIN Employees E ON CAST(E.$codeCol AS varchar(50)) = CAST(L.UserId AS varchar(50))
 WHERE L.LogDate >= @from
"@ @{ '@from' = $from }
    foreach ($r in $rows.Rows) {
      [void]$punches.Add(@{
        code = [string]$r.UserId
        name = if ($r.EmployeeName -is [DBNull]) { '' } else { [string]$r.EmployeeName }
        time = [string]$r.LogDate
      })
    }
  }

  if ($DryRun) {
    Log ("dry run: {0} punches since {1:yyyy-MM-dd} from {2}" -f $punches.Count, $from, ($months -join ', '))
    $punches | Select-Object -First 15 | ForEach-Object { Write-Host ('   {0,-10} {1,-30} {2}' -f $_.code, $_.name, $_.time) }
    exit 0
  }

  # Whole days per request, so a day's In/Out is never split across two.
  $byDay = $punches | Group-Object { $_.time.Substring(0, 10) } | Sort-Object Name
  $batches = @(); $cur = New-Object System.Collections.ArrayList
  foreach ($g in $byDay) {
    if ($cur.Count -gt 0 -and ($cur.Count + $g.Count) -gt 20000) { $batches += ,$cur; $cur = New-Object System.Collections.ArrayList }
    foreach ($p in $g.Group) { [void]$cur.Add($p) }
  }
  $batches += ,$cur

  $url = ($cfg.erpUrl.TrimEnd('/')) + '/api/hr/attendance/biometric'
  foreach ($batch in $batches) {
    $body = @{ source = $env:COMPUTERNAME; punches = @($batch) } | ConvertTo-Json -Depth 4 -Compress
    $res = Invoke-RestMethod -Method Post -Uri $url -Body ([Text.Encoding]::UTF8.GetBytes($body)) `
      -ContentType 'application/json; charset=utf-8' -Headers @{ 'x-sync-key' = $cfg.syncKey } -TimeoutSec 120
    $un = @($res.unmatched).Count
    Log ("sent {0} punches -> {1} day-rows: {2} new, {3} updated, {4} unchanged, {5} kept (HR-marked), {6} unmatched IDs" -f `
      $res.punches, $res.days, $res.created, $res.updated, $res.unchanged, $res.kept, $un)
  }
} catch {
  Log ("ERROR: " + $_.Exception.Message)
  exit 1
}
