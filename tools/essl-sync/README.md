# eSSL biometric → ERP attendance sync

The eSSL (eTimeTrackLite) database is a SQL Server on the office PC
(`SERVER\SQLEXPRESS`, login `essl`). The hosted ERP can't reach it, so
`essl-sync.ps1` runs on that PC every 5 minutes. It reads the punches from
the last 2 days and posts them to `POST /api/hr/attendance/biometric`.

The ERP takes each person's first punch of the day as In and the last as Out,
then works out hours and the late mark from the HR shift settings. Sending the
same punches again changes nothing. If HR marked a day by hand, that status
stays; the sync only fills in times that are still blank. Months whose payroll
is finalised are skipped.

## Setup (once, on the eSSL PC)

1. Copy this folder to the PC, e.g. `C:\essl-sync`.
2. Open PowerShell as Administrator in that folder and run
   `powershell -ExecutionPolicy Bypass -File .\Install-Task.ps1`.
   The first run creates `essl-sync.config.json` and opens it. Fill in
   `sqlPassword`, then run the script again. It generates `syncKey`, prints it
   and registers the scheduled task.
3. On the ERP server, add `BIOMETRIC_SYNC_KEY=<that key>` to `.env.local` and restart.
4. Check: `.\essl-sync.ps1 -Discover` shows the database and tables. If the
   database isn't `etimetracklite1`, change `database` in the config.
   `.\essl-sync.ps1 -DryRun` shows the punches without sending them.
5. Optional backfill: `.\essl-sync.ps1 -Days 31`.

## Linking people

Punches are matched to an employee in this order: their **Biometric Code**
(on the employee form; this is the machine's user ID, and leading zeros are
ignored), then the ERP employee code, then an exact match on the name. The
Muster Roll shows when the last sync ran and which machine IDs aren't linked
to anyone yet.

The log is in `essl-sync.log` next to the script.

## Alternative: the ERP reads the SQL Server directly (by IP)

If the office PC can be reached from the internet, you don't need the
script. Set these in the ERP's `.env.local` and the ERP pulls every 5 minutes
by itself. The Muster Roll then shows a **Sync now** button, and any
connection error.

```
ESSL_SQL_HOST=<office public IP>
ESSL_SQL_PORT=1433            # the fixed TCP port set for SQLEXPRESS
ESSL_SQL_USER=essl
ESSL_SQL_PASSWORD=...
ESSL_SQL_DB=etimetracklite1
ESSL_POLL_MINUTES=5
```

What the office side needs:
1. A **static public IP** from the ISP. A 192.168.x.x LAN address can't be
   reached from Hostinger.
2. In SQL Server Configuration Manager, open SQLEXPRESS → Protocols → TCP/IP.
   Turn it on, set IPAll → TCP Port = 1433 and clear TCP Dynamic Ports, then
   restart the service.
3. On the router, forward TCP 1433 to the eSSL PC. In Windows Firewall, allow
   1433 inbound **only from the Hostinger server's IP**, never from Any.
4. Use a read-only SQL login if you can, plus a strong password.
