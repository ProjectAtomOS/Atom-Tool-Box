# AtomToolBox - context menu entries helper (HKCU only, no admin required).
# Usage: menu_tool.ps1 -Verb <id> -Action add|remove|check   (-Verb all valid for check)
# Writes via the .NET Registry API (New-Item cannot handle literal '*' key names and
# wildcard paths). Every write is self-verified with a read-back; output is one
# compressed JSON object on stdout.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('copy_path', 'cmd_here', 'powershell_here', 'notepad', 'take_ownership', 'all')]
  [string]$Verb,
  [Parameter(Mandatory = $true)]
  [ValidateSet('add', 'remove', 'check')]
  [string]$Action
)
$ErrorActionPreference = 'Stop'

# ---- commands (registry command values; %1/%V substituted by the shell) ----
$COPY_CMD = 'powershell.exe -NoProfile -WindowStyle Hidden -Command "Set-Clipboard -Value ''%1''"'
$CMD_CMD = 'cmd.exe /s /k pushd "%V"'
$PS_CMD = 'powershell.exe -NoProfile -NoExit -Command "Set-Location -LiteralPath ''%V''"'
$NOTEPAD_CMD = 'notepad.exe "%1"'
$TAKEOWN_CMD = 'powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process cmd -Verb RunAs -ArgumentList ''/c takeown /f \"%1\" /r /d y && icacls \"%1\" /grant *S-1-5-32-544:F /t''"'

# ---- verb table: 'Take Ownership' intentionally manages the SAME keys the user
# ---- already has (with a corrected command), so it never duplicates entries.
$VerbDefs = @{
  copy_path = @(
    @{ Key = 'Software\Classes\AllFilesystemObjects\shell\AtomCopyPath'; Command = $COPY_CMD; Values = [ordered]@{ 'MUIVerb' = 'Copy as path'; 'Icon' = 'imageres.dll,-5302'; 'Position' = 'Top' } }
  )
  cmd_here = @(
    @{ Key = 'Software\Classes\Directory\shell\AtomCmdHere'; Command = $CMD_CMD; Values = [ordered]@{ 'MUIVerb' = 'Open Command Prompt here'; 'Icon' = 'cmd.exe' } }
    @{ Key = 'Software\Classes\Directory\Background\shell\AtomCmdHere'; Command = $CMD_CMD; Values = [ordered]@{ 'MUIVerb' = 'Open Command Prompt here'; 'Icon' = 'cmd.exe' } }
  )
  powershell_here = @(
    @{ Key = 'Software\Classes\Directory\shell\AtomPwshHere'; Command = $PS_CMD; Values = [ordered]@{ 'MUIVerb' = 'Open PowerShell here'; 'Icon' = 'powershell.exe' } }
    @{ Key = 'Software\Classes\Directory\Background\shell\AtomPwshHere'; Command = $PS_CMD; Values = [ordered]@{ 'MUIVerb' = 'Open PowerShell here'; 'Icon' = 'powershell.exe' } }
  )
  notepad = @(
    @{ Key = 'Software\Classes\*\shell\AtomOpenNotepad'; Command = $NOTEPAD_CMD; Values = [ordered]@{ 'MUIVerb' = 'Open with Notepad'; 'Icon' = 'notepad.exe' } }
  )
  take_ownership = @(
    @{ Key = 'Software\Classes\*\shell\TakeOwnership'; Command = $TAKEOWN_CMD; Values = [ordered]@{ 'MUIVerb' = 'Take Ownership'; 'Icon' = 'takeown.exe'; 'HasLUAShield' = '' } }
    @{ Key = 'Software\Classes\Directory\shell\TakeOwnership'; Command = $TAKEOWN_CMD; Values = [ordered]@{ 'MUIVerb' = 'Take Ownership'; 'Icon' = 'takeown.exe'; 'HasLUAShield' = '' } }
  )
}
$VERB_IDS = @('copy_path', 'cmd_here', 'powershell_here', 'notepad', 'take_ownership')

function ApplyEntry($entry) {
  $k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($entry.Key)
  foreach ($name in $entry.Values.Keys) {
    $k.SetValue($name, [string]$entry.Values[$name], [Microsoft.Win32.RegistryValueKind]::String)
  }
  $ck = $k.CreateSubKey('command')
  $ck.SetValue('', [string]$entry.Command, [Microsoft.Win32.RegistryValueKind]::String)
  $ck.Close()
  $k.Close()
}

function TestEntry($entry) {
  $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($entry.Key)
  if (-not $k) { return $false }
  $ok = $true
  foreach ($name in $entry.Values.Keys) {
    $v = $k.GetValue($name, $null)
    if ($null -eq $v) { $ok = $false }
  }
  $ck = $k.OpenSubKey('command')
  if (-not $ck) { $ok = $false }
  else {
    $cmd = $ck.GetValue('', $null)
    if ([string]$cmd -ne [string]$entry.Command) { $ok = $false }
    $ck.Close()
  }
  $k.Close()
  return $ok
}

function TestEntryExists($entry) {
  $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($entry.Key)
  if (-not $k) { return $false }
  $ck = $k.OpenSubKey('command')
  if ($ck) { $ck.Close() }
  $k.Close()
  return $true
}

function RemoveEntry($entry) {
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($entry.Key, $false)
}

function ProcessVerb($id, $action) {
  $entries = $VerbDefs[$id]
  $details = @()
  $allOk = $true
  foreach ($e in $entries) {
    if ($action -eq 'add') {
      ApplyEntry $e
      $verified = TestEntry $e
      if (-not $verified) { $allOk = $false }
      $details += [pscustomobject]@{ key = $e.Key; verified = $verified }
    }
    elseif ($action -eq 'remove') {
      RemoveEntry $e
      $gone = -not (TestEntryExists $e)
      if (-not $gone) { $allOk = $false }
      $details += [pscustomobject]@{ key = $e.Key; removed = $gone }
    }
    else {
      $present = TestEntry $e
      $exists = TestEntryExists $e
      if (-not $present) { $allOk = $false }
      $details += [pscustomobject]@{ key = $e.Key; present = $present; partial = ($exists -and -not $present) }
    }
  }
  return [pscustomobject]@{ verb = $id; ok = $allOk; entries = $details }
}

if ($Action -ne 'check' -and $Verb -eq 'all') {
  [pscustomobject]@{ ok = $false; error = '-Verb all is only valid with -Action check' } | ConvertTo-Json -Compress
  exit 1
}

$targets = if ($Verb -eq 'all') { $VERB_IDS } else { @($Verb) }
$results = @()
$overall = $true
foreach ($id in $targets) {
  $r = ProcessVerb $id $Action
  if (-not $r.ok) { $overall = $false }
  $results += $r
}

[pscustomobject]@{ ok = $overall; action = $Action; results = $results } | ConvertTo-Json -Compress -Depth 6
exit 0
