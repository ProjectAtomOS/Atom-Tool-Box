# AtomToolBox — TIMER RESOLUTION helper (used by the POWER PLANS page).
#
# Windows wakes expiring timers on a system-wide tick (default ~15.625 ms).
# A process can ask ntdll!NtSetTimerResolution for a finer tick (Windows then
# serves the finest request held by ANY process) but the request only lasts
# while that process lives. This script is that process:
#
#   -Action status   -> read-and-exit JSON (live timer + whether OUR helper runs)
#   -Action hold     -> long-running hidden holder (started by the app, detached)
#   -Action release  -> stop the holder and confirm the timer state afterwards
#
# State file: %LOCALAPPDATA%\AtomToolBox\timer_res.json  ({pid, units, start})
# The start timestamp guards against PID reuse: release only stops a process
# whose StartTime matches the one recorded by the holder itself.
#
# NOTE: no double values are written to the state file (units = 100 ns steps),
# so this is culture-proof; ms values in the status JSON are invariant.

param(
  [Parameter(Mandatory = $true)][ValidateSet('status', 'hold', 'release')][string]$Action,
  [int]$Units = 5000   # 100 ns units; 5000 = 0.5 ms, 10000 = 1 ms
)

$ErrorActionPreference = 'Stop'

$pidFile = Join-Path $env:LOCALAPPDATA 'AtomToolBox\timer_res.json'

if (-not ('AtomTimer.Nt' -as [type])) {
  Add-Type -Namespace AtomTimer -Name Nt -MemberDefinition @'
[DllImport("ntdll.dll")] public static extern int NtQueryTimerResolution(out uint MaximumTime, out uint MinimumTime, out uint CurrentTime);
[DllImport("ntdll.dll")] public static extern int NtSetTimerResolution(uint DesiredResolution, bool SetResolution, out uint CurrentResolution);
'@
}

function Get-TimerInfo {
  # NtQueryTimerResolution: param1 = slowest (default ~156250), param2 = fastest (5000).
  $slow = 0; $fast = 0; $cur = 0
  [AtomTimer.Nt]::NtQueryTimerResolution([ref]$slow, [ref]$fast, [ref]$cur) | Out-Null
  [pscustomobject]@{
    slowestMs = [math]::Round($slow / 10000.0, 3)
    fastestMs = [math]::Round($fast / 10000.0, 3)
    currentMs = [math]::Round($cur / 10000.0, 3)
  }
}

function Get-Holder {
  # Returns the holder record {pid, units, start} only when the recorded
  # process is still alive, is a powershell, and its StartTime matches.
  if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
  try { $j = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json } catch { return $null }
  if (-not $j -or -not $j.pid) { return $null }
  $p = Get-Process -Id ([int]$j.pid) -ErrorAction SilentlyContinue
  if (-not $p -or $p.ProcessName -ne 'powershell') { return $null }
  try {
    if ($p.StartTime.ToUniversalTime().ToString('o') -ne [string]$j.start) { return $null }
  } catch { return $null }
  return $j
}

switch ($Action) {

  'status' {
    $t = Get-TimerInfo
    $h = Get-Holder
    # Self-heal: remove a stale state file whose process is gone.
    if (-not $h -and (Test-Path -LiteralPath $pidFile)) {
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
    $hMs = $null; $hPid = $null; $hUnits = $null
    if ($h) { $hUnits = [int]$h.units; $hMs = [math]::Round($hUnits / 10000.0, 3); $hPid = [int]$h.pid }
    @{
      ok         = $true
      currentMs  = $t.currentMs
      fastestMs  = $t.fastestMs
      slowestMs  = $t.slowestMs
      holder     = [bool]$h
      holderMs   = $hMs
      holderUnits = $hUnits
      holderPid  = $hPid
    } | ConvertTo-Json -Compress
    exit 0
  }

  'hold' {
    if ($Units -lt 5000) { $Units = 5000 }
    if ($Units -gt 156250) { $Units = 156250 }

    $dir = Split-Path -Parent $pidFile
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }

    # One holder at a time: bail out if a live holder already exists.
    $existing = Get-Holder
    if ($existing -and [int]$existing.pid -ne $PID) { exit 0 }

    $cur = 0
    $rc = [AtomTimer.Nt]::NtSetTimerResolution([uint32]$Units, $true, [ref]$cur)
    if ($rc -ne 0) { exit 1 }

    $start = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    @{ pid = $PID; units = $Units; start = $start } | ConvertTo-Json -Compress | Set-Content -LiteralPath $pidFile -Encoding ASCII

    try {
      while ($true) {
        Start-Sleep -Seconds 10
        # Safety re-assert: only if the live timer somehow rose above our request
        # (can only happen if our request was dropped; keeps one request, not many).
        $slow = 0; $fast = 0; $now = 0
        [AtomTimer.Nt]::NtQueryTimerResolution([ref]$slow, [ref]$fast, [ref]$now) | Out-Null
        if ($now -gt ($Units + [int]($Units * 0.1))) {
          $tmp = 0
          [AtomTimer.Nt]::NtSetTimerResolution([uint32]$Units, $true, [ref]$tmp) | Out-Null
        }
      }
    } finally {
      try { [AtomTimer.Nt]::NtSetTimerResolution([uint32]$Units, $false, [ref]$cur) | Out-Null } catch {}
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
    exit 0
  }

  'release' {
    $h = Get-Holder
    if ($h) {
      Stop-Process -Id ([int]$h.pid) -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
    }
    if (Test-Path -LiteralPath $pidFile) {
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
    $t = Get-TimerInfo
    @{
      ok        = $true
      released  = [bool]$h
      currentMs = $t.currentMs
      fastestMs = $t.fastestMs
      slowestMs = $t.slowestMs
    } | ConvertTo-Json -Compress
    exit 0
  }
}
