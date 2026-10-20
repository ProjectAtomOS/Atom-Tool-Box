# AtomToolBox - Startup Manager tool
# Lists and toggles Windows startup items with read-back verification.
#
# Sources:
#   run-hkcu      HKCU\Software\Microsoft\Windows\CurrentVersion\Run          (override key: StartupApproved\Run)
#   run-hklm      HKLM\Software\Microsoft\Windows\CurrentVersion\Run          (override key: StartupApproved\Run)
#   run-hkcu32    HKCU\Software\WOW6432Node\...\Run                          (override key: StartupApproved\Run32)
#   run-hklm32    HKLM\Software\WOW6432Node\...\Run                          (override key: StartupApproved\Run32)
#   folder-user   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
#   folder-common %ProgramData%\Microsoft\Windows\Start Menu\Programs\Startup
#
# Registry items: disable = write 12-byte StartupApproved blob (03 00 00 00 + LE FILETIME),
#                 enable  = delete the override value (absent or byte0=02 means enabled).
#                 The Run value itself is NEVER modified or deleted.
# Folder items:   disable = rename "name.lnk" -> "name.lnk.disabled",
#                 enable  = rename back to the exact original name.
#                 File contents are never modified.
#
# Usage:
#   startup_tool.ps1 -Action list
#   startup_tool.ps1 -Action set -Id "<store>|<name>" -State disable|enable
# Always prints one JSON object: {"ok":true,...} or {"ok":false,"error":"..."}

param(
  [Parameter(Mandatory=$true)][ValidateSet('list','set')] [string]$Action,
  [string]$Id,
  [ValidateSet('disable','enable')] [string]$State
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$STORES = @(
  @{ Id = 'run-hkcu';   Hive = 'HKCU'; Path = 'Software\Microsoft\Windows\CurrentVersion\Run';             Approved = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run';   Label = 'HKCU RUN' },
  @{ Id = 'run-hklm';   Hive = 'HKLM'; Path = 'Software\Microsoft\Windows\CurrentVersion\Run';             Approved = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run';   Label = 'HKLM RUN' },
  @{ Id = 'run-hkcu32'; Hive = 'HKCU'; Path = 'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; Approved = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32'; Label = 'HKCU RUN (32-BIT)' },
  @{ Id = 'run-hklm32'; Hive = 'HKLM'; Path = 'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; Approved = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32'; Label = 'HKLM RUN (32-BIT)' }
)

$FOLDERS = @(
  @{ Id = 'folder-user';   Label = 'STARTUP FOLDER (USER)';      Path = ([Environment]::GetFolderPath('Startup')) },
  @{ Id = 'folder-common'; Label = 'STARTUP FOLDER (ALL USERS)'; Path = ([Environment]::GetFolderPath('CommonStartup')) }
)

function Write-Json($obj) {
  Write-Output (ConvertTo-Json -Compress -InputObject $obj -Depth 6)
}

function Get-Key([string]$hive, [string]$sub, [bool]$writable) {
  $h = if ($hive -eq 'HKLM') { [Microsoft.Win32.RegistryHive]::LocalMachine } else { [Microsoft.Win32.RegistryHive]::CurrentUser }
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($h, [Microsoft.Win32.RegistryView]::Registry64)
  return $base.OpenSubKey($sub, $writable)
}

function Get-KeyCreate([string]$hive, [string]$sub) {
  $h = if ($hive -eq 'HKLM') { [Microsoft.Win32.RegistryHive]::LocalMachine } else { [Microsoft.Win32.RegistryHive]::CurrentUser }
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($h, [Microsoft.Win32.RegistryView]::Registry64)
  return $base.CreateSubKey($sub)
}

# Read the StartupApproved override directly and return only primitives.
# (A function must never pipe/return a byte[] - PowerShell unwraps it to object[]
#  and type checks on the caller side stop working.)
function Get-OverrideInfo([string]$hive, [string]$approvedPath, [string]$name) {
  $k = Get-Key $hive $approvedPath $false
  if (-not $k) { return [ordered]@{ present = $false; len = 0; b0 = -1 } }
  $blob = $k.GetValue($name, $null)
  if ($null -eq $blob) { return [ordered]@{ present = $false; len = 0; b0 = -1 } }
  if ($blob -is [byte[]]) {
    if ($blob.Length -eq 0) { return [ordered]@{ present = $false; len = 0; b0 = -1 } }
    return [ordered]@{ present = $true; len = $blob.Length; b0 = [int]$blob[0] }
  }
  if ($blob -is [object[]]) {
    if ($blob.Count -eq 0 -or $null -eq $blob[0]) { return [ordered]@{ present = $false; len = 0; b0 = -1 } }
    return [ordered]@{ present = $true; len = $blob.Count; b0 = [int]([byte]$blob[0]) }
  }
  return [ordered]@{ present = $true; len = -1; b0 = -1 }
}

# ---------- LIST ----------

function Invoke-List {
  $items = New-Object System.Collections.ArrayList
  $stale = 0

  foreach ($st in $STORES) {
    $key = Get-Key $st.Hive $st.Path $false
    if (-not $key) { continue }
    $runNames = @($key.GetValueNames() | Where-Object { $_ -ne '' })
    $apKey = Get-Key $st.Hive $st.Approved $false

    foreach ($name in ($runNames | Sort-Object)) {
      $val = $key.GetValue($name, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $oi = Get-OverrideInfo $st.Hive $st.Approved $name
      $disabled = ($oi.present -and ($oi.b0 -eq 3))
      [void]$items.Add([ordered]@{
        id      = "$($st.Id)|$name"
        name    = $name
        source  = $st.Label
        kind    = 'reg'
        enabled = (-not $disabled)
        command = [string]$val
      })
    }

    # Count override values that have no matching Run value (stale) - left untouched.
    if ($apKey) {
      foreach ($an in @($apKey.GetValueNames())) {
        if ($an -eq '') { continue }
        if (-not ($runNames -contains $an)) { $stale++ }
      }
    }
  }

  foreach ($st in $FOLDERS) {
    $dir = $st.Path
    if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
    $files = @(Get-ChildItem -LiteralPath $dir -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'desktop.ini' })
    $names = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($f in $files) { [void]$names.Add($f.Name) }

    foreach ($f in ($files | Sort-Object Name)) {
      $n = $f.Name
      if ($n.Length -gt 9 -and $n.ToLower().EndsWith('.disabled')) {
        $baseName = $n.Substring(0, $n.Length - 9)
        if ($names.Contains($baseName)) { continue }  # live file with same base also present - skip the dead twin
        [void]$items.Add([ordered]@{
          id      = "$($st.Id)|$baseName"
          name    = $baseName
          source  = $st.Label
          kind    = 'folder'
          enabled = $false
          command = (Join-Path $dir $n)
        })
      } else {
        [void]$items.Add([ordered]@{
          id      = "$($st.Id)|$n"
          name    = $n
          source  = $st.Label
          kind    = 'folder'
          enabled = $true
          command = (Join-Path $dir $n)
        })
      }
    }
  }

  $total = $items.Count
  $en = @($items | Where-Object { $_.enabled }).Count
  return [ordered]@{
    ok    = $true
    items = @($items)
    stats = [ordered]@{ total = $total; enabled = $en; disabled = ($total - $en); stale = $stale }
  }
}

# ---------- SET ----------

function Invoke-Set {
  if (-not $Id -or -not $State) { throw 'Id and State are required for set' }
  $parts = $Id.Split([char]'|', 2)
  if ($parts.Count -ne 2 -or -not $parts[1]) { throw 'Invalid item id' }
  $storeId = $parts[0]
  $itemName = $parts[1]

  $regStore = $STORES | Where-Object { $_.Id -eq $storeId } | Select-Object -First 1
  if ($regStore) { return Invoke-SetReg $regStore $itemName }

  $folderStore = $FOLDERS | Where-Object { $_.Id -eq $storeId } | Select-Object -First 1
  if ($folderStore) { return Invoke-SetFolder $folderStore $itemName }

  throw "Unknown store: $storeId"
}

function Invoke-SetReg($st, [string]$itemName) {
  $runKey = Get-Key $st.Hive $st.Path $false
  $runNames = if ($runKey) { @($runKey.GetValueNames()) } else { @() }
  if (-not ($runNames -contains $itemName)) {
    return [ordered]@{ ok = $false; error = 'NOT_FOUND'; id = $Id; name = $itemName; source = $st.Label }
  }

  if ($State -eq 'disable') {
    $apKey = Get-KeyCreate $st.Hive $st.Approved
    $ft = [DateTime]::UtcNow.ToFileTime()
    $blob = New-Object byte[] 12
    $blob[0] = 3
    [BitConverter]::GetBytes($ft).CopyTo($blob, 4)
    $apKey.SetValue($itemName, $blob, [Microsoft.Win32.RegistryValueKind]::Binary)

    $oi = Get-OverrideInfo $st.Hive $st.Approved $itemName
    $verified = $oi.present -and ($oi.len -eq 12) -and ($oi.b0 -eq 3)
    return [ordered]@{
      ok = $true; verified = $verified; id = $Id; name = $itemName; source = $st.Label
      state = 'disabled'; error = $(if ($verified) { $null } else { 'read-back mismatch' })
    }
  }

  # enable: remove the disabled override (absent or byte0!=3 means enabled)
  $oi = Get-OverrideInfo $st.Hive $st.Approved $itemName
  $wasDisabled = $oi.present -and ($oi.b0 -eq 3)
  if ($wasDisabled) {
    $apKey = Get-Key $st.Hive $st.Approved $true
    if ($apKey) { $apKey.DeleteValue($itemName, $false) }
    $oi2 = Get-OverrideInfo $st.Hive $st.Approved $itemName
    $verified = -not ($oi2.present -and ($oi2.b0 -eq 3))
  } else {
    $verified = $true  # already enabled - nothing to change
  }
  return [ordered]@{
    ok = $true; verified = $verified; id = $Id; name = $itemName; source = $st.Label
    state = 'enabled'; error = $(if ($verified) { $null } else { 'override value still present' })
  }
}

function Invoke-SetFolder($st, [string]$itemName) {
  $dir = $st.Path
  if (-not $dir -or -not (Test-Path -LiteralPath $dir)) {
    return [ordered]@{ ok = $false; error = 'NOT_FOUND'; id = $Id; name = $itemName; source = $st.Label }
  }
  $target = Join-Path $dir $itemName
  $deadName = $target + '.disabled'
  $targetExists = Test-Path -LiteralPath $target
  $deadExists = Test-Path -LiteralPath $deadName

  if ($State -eq 'disable') {
    if (-not $targetExists) {
      if ($deadExists) {
        return [ordered]@{ ok = $true; verified = $true; id = $Id; name = $itemName; source = $st.Label; state = 'disabled'; error = $null }
      }
      return [ordered]@{ ok = $false; error = 'NOT_FOUND'; id = $Id; name = $itemName; source = $st.Label }
    }
    if ($deadExists) {
      return [ordered]@{ ok = $false; error = 'CONFLICT: a .disabled file with the same name already exists'; id = $Id; name = $itemName; source = $st.Label }
    }
    Move-Item -LiteralPath $target -Destination $deadName
    $verified = (-not (Test-Path -LiteralPath $target)) -and (Test-Path -LiteralPath $deadName)
    return [ordered]@{
      ok = $true; verified = $verified; id = $Id; name = $itemName; source = $st.Label
      state = 'disabled'; error = $(if ($verified) { $null } else { 'rename verify failed' })
    }
  }

  # enable: rename .disabled back to the exact original name
  if (-not $deadExists) {
    if ($targetExists) {
      return [ordered]@{ ok = $true; verified = $true; id = $Id; name = $itemName; source = $st.Label; state = 'enabled'; error = $null }
    }
    return [ordered]@{ ok = $false; error = 'NOT_FOUND'; id = $Id; name = $itemName; source = $st.Label }
  }
  if ($targetExists) {
    return [ordered]@{ ok = $false; error = 'CONFLICT: the original file already exists'; id = $Id; name = $itemName; source = $st.Label }
  }
  Move-Item -LiteralPath $deadName -Destination $target
  $verified = (Test-Path -LiteralPath $target) -and (-not (Test-Path -LiteralPath $deadName))
  return [ordered]@{
    ok = $true; verified = $verified; id = $Id; name = $itemName; source = $st.Label
    state = 'enabled'; error = $(if ($verified) { $null } else { 'rename verify failed' })
  }
}

# ---------- MAIN ----------

try {
  $result = if ($Action -eq 'list') { Invoke-List } else { Invoke-Set }
} catch {
  $result = [ordered]@{ ok = $false; error = $_.Exception.Message }
}
Write-Json $result
