# AtomToolBox - metered default (DefaultMediaCost) helper.
# The key is owned by NT SERVICE\TrustedInstaller and grants Administrators
# read-only by default, so it needs a take-ownership dance:
#   enable SeTakeOwnership/SeRestore -> take owner -> temp ACL grant ->
#   write values -> restore exact DACL -> restore exact owner.
# Note: the informational SE_DACL_AUTO_INHERITED flag is stripped by the OS on
# any DACL write (verified empirically); owner, ACEs, P flag and values are
# restored exactly.
param([int]$Target = -1)
$ErrorActionPreference = 'Stop'
if ($Target -ne 1 -and $Target -ne 2) { Write-Host 'usage: metered_lock.ps1 <1|2>'; exit 2 }

$code = @'
using System;
using System.Runtime.InteropServices;
public static class AtomAcl {
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr h, int acc, out IntPtr phtok);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool LookupPrivilegeValue(string host, string name, out long pluid);
  [DllImport("advapi32.dll", ExactSpelling=true, SetLastError=true)] static extern bool AdjustTokenPrivileges(IntPtr htok, bool disall, ref TokPriv1Luid newst, int len, IntPtr prev, IntPtr relen);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [StructLayout(LayoutKind.Sequential, Pack=1)] internal struct TokPriv1Luid { public int Count; public long Luid; public int Attr; }
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern int RegOpenKeyEx(IntPtr hKey, string sub, int opt, int sam, out IntPtr phk);
  [DllImport("advapi32.dll", SetLastError=true)] static extern int RegSetKeySecurity(IntPtr hKey, int si, byte[] sd);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern int RegCloseKey(IntPtr hKey);
  public static bool Enable(string p) {
    IntPtr htok;
    if (!OpenProcessToken(GetCurrentProcess(), 0x28, out htok)) return false;
    TokPriv1Luid tp; tp.Count = 1; tp.Attr = 0x2; long luid;
    if (!LookupPrivilegeValue(null, p, out luid)) return false;
    tp.Luid = luid;
    if (!AdjustTokenPrivileges(htok, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero)) return false;
    return Marshal.GetLastWin32Error() == 0;
  }
  public static int Open(string sub, int rights, out IntPtr h) { h = IntPtr.Zero; return RegOpenKeyEx(new IntPtr(unchecked((int)0x80000002)), sub, 0, rights, out h); }
  public static int SetSec(IntPtr h, int si, byte[] sd) { return RegSetKeySecurity(h, si, sd); }
}
'@
Add-Type -TypeDefinition $code
[void][AtomAcl]::Enable('SeTakeOwnershipPrivilege')
[void][AtomAcl]::Enable('SeRestorePrivilege')

$sub = 'SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\DefaultMediaCost'
$k   = 'HKLM:\' + $sub

# already at target -> nothing to do
$cur = Get-ItemProperty -Path $k
if ($cur.Ethernet -eq $Target -and $cur.WiFi -eq $Target) { exit 0 }

# snapshot the exact security descriptor
$origSddl  = (Get-Acl -Path $k).Sddl
$tmp = New-Object System.Security.AccessControl.RegistrySecurity
$tmp.SetSecurityDescriptorSddlForm($origSddl)
$origDacl  = $tmp.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)
$origOwner = [regex]::Match($origSddl, '^O:(S-1-[0-9-]+)').Groups[1].Value
$admins = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')

function NormSddl([string]$s) {
  # OS strips auto-inherit flags on DACL writes; normalize both sides for comparison
  foreach ($p in @(@('D:PAIAR','D:P'),@('D:PARAI','D:P'),@('D:PAI','D:P'),@('D:PAR','D:P'),@('D:AIAR','D:'),@('D:ARAI','D:'),@('D:AI','D:'),@('D:AR','D:'))) { $s = $s.Replace($p[0], $p[1]) }
  return $s
}

$h = [IntPtr]::Zero
$fail = $false
try {
  # 1. take ownership (WRITE_OWNER granted via SeTakeOwnership)
  $r = [AtomAcl]::Open($sub, 0xA0000, [ref]$h)
  if ($r -ne 0) { throw "open(write_owner) = $r" }
  $sd = New-Object System.Security.AccessControl.RegistrySecurity
  $sd.SetOwner($admins)
  $r = [AtomAcl]::SetSec($h, 1, $sd.GetSecurityDescriptorBinaryForm())
  [void][AtomAcl]::RegCloseKey($h)
  if ($r -ne 0) { throw "set-owner = $r" }

  # 2. temporary ACL grant (WRITE_DAC via owner rights) so the values are writable
  $r = [AtomAcl]::Open($sub, 0x60000, [ref]$h)
  if ($r -ne 0) { throw "open(write_dac) = $r" }
  $sd = New-Object System.Security.AccessControl.RegistrySecurity
  $sd.SetSecurityDescriptorSddlForm($origDacl)
  $sd.AddAccessRule((New-Object System.Security.AccessControl.RegistryAccessRule($admins, 'FullControl', 'Allow')))
  $r = [AtomAcl]::SetSec($h, 4, $sd.GetSecurityDescriptorBinaryForm())
  [void][AtomAcl]::RegCloseKey($h)
  if ($r -ne 0) { throw "grant = $r" }

  # 3. write target values
  Set-ItemProperty -Path $k -Name Ethernet -Value $Target -Type DWord
  Set-ItemProperty -Path $k -Name WiFi     -Value $Target -Type DWord
} catch { $fail = $true; Write-Host "metered apply error: $($_.Exception.Message)" }

# 4. always restore: exact DACL, then exact owner
try {
  $r = [AtomAcl]::Open($sub, 0x60000, [ref]$h)
  if ($r -eq 0) {
    $sd = New-Object System.Security.AccessControl.RegistrySecurity
    $sd.SetSecurityDescriptorSddlForm($origDacl)
    $r = [AtomAcl]::SetSec($h, 4, $sd.GetSecurityDescriptorBinaryForm())
    [void][AtomAcl]::RegCloseKey($h)
    if ($r -ne 0) { $fail = $true; Write-Host "dacl restore = $r" }
  } else { $fail = $true; Write-Host "open(write_dac restore) = $r" }

  $r = [AtomAcl]::Open($sub, 0xA0000, [ref]$h)
  if ($r -eq 0) {
    $sd = New-Object System.Security.AccessControl.RegistrySecurity
    $sd.SetOwner((New-Object System.Security.Principal.SecurityIdentifier($origOwner)))
    $r = [AtomAcl]::SetSec($h, 1, $sd.GetSecurityDescriptorBinaryForm())
    [void][AtomAcl]::RegCloseKey($h)
    if ($r -ne 0) { $fail = $true; Write-Host "owner restore = $r" }
  } else { $fail = $true; Write-Host "open(write_owner restore) = $r" }
} catch { $fail = $true; Write-Host "restore error: $($_.Exception.Message)" }

# 5. verify
$now = Get-ItemProperty -Path $k
if ($now.Ethernet -ne $Target -or $now.WiFi -ne $Target) { $fail = $true; Write-Host 'value verify failed' }
$acl = Get-Acl -Path $k
if ((NormSddl $acl.Sddl) -ne (NormSddl $origSddl)) { $fail = $true; Write-Host 'acl verify failed' }

if ($fail) { exit 1 } else { exit 0 }
