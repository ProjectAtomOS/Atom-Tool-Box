# AtomToolBox QA - recursive HKCU key snapshot / restore.
# Usage:
#   reg_tree.ps1 -Mode snapshot -KeysFile keys.json -File snap.json
#   reg_tree.ps1 -Mode restore  -KeysFile keys.json -File snap.json
# keys.json = JSON array of HKCU-relative key paths.
param(
  [Parameter(Mandatory = $true)][ValidateSet('snapshot', 'restore')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$KeysFile,
  [Parameter(Mandatory = $true)][string]$File
)
$ErrorActionPreference = 'Stop'
$CU = [Microsoft.Win32.Registry]::CurrentUser

function Read-Values($rk) {
  $vals = @()
  foreach ($n in $rk.GetValueNames()) {
    $kind = $rk.GetValueKind($n)
    $v = $rk.GetValue($n)
    $tv = $null
    if ($kind -eq 'Binary') { $tv = [Convert]::ToBase64String([byte[]]$v) }
    elseif ($kind -eq 'MultiString') { $tv = @([string[]]$v) }
    elseif ($null -eq $v) { $tv = '' }
    else { $tv = [string]$v }
    $vals += [pscustomobject]@{ name = $n; kind = [string]$kind; value = $tv }
  }
  return , @($vals)
}

function Read-Tree($rk) {
  $subs = @()
  foreach ($sn in $rk.GetSubKeyNames()) {
    $child = $rk.OpenSubKey($sn)
    $subs += [pscustomobject]@{ name = $sn; tree = (Read-Tree $child) }
    $child.Close()
  }
  return [pscustomobject]@{ values = (Read-Values $rk); subkeys = @($subs) }
}

function Write-Value($rk, $v) {
  switch ([string]$v.kind) {
    'Binary' { $rk.SetValue([string]$v.name, [byte[]][Convert]::FromBase64String([string]$v.value), [Microsoft.Win32.RegistryValueKind]::Binary) }
    'MultiString' { $rk.SetValue([string]$v.name, [string[]]@($v.value), [Microsoft.Win32.RegistryValueKind]::MultiString) }
    'DWord' { $rk.SetValue([string]$v.name, [int]$v.value, [Microsoft.Win32.RegistryValueKind]::DWord) }
    'QWord' { $rk.SetValue([string]$v.name, [long]$v.value, [Microsoft.Win32.RegistryValueKind]::QWord) }
    'ExpandString' { $rk.SetValue([string]$v.name, [string]$v.value, [Microsoft.Win32.RegistryValueKind]::ExpandString) }
    default { $rk.SetValue([string]$v.name, [string]$v.value, [Microsoft.Win32.RegistryValueKind]::String) }
  }
}

function Write-Tree($path, $tree) {
  $rk = $CU.CreateSubKey($path)
  foreach ($v in @($tree.values)) { if ($v) { Write-Value $rk $v } }
  $rk.Close()
  foreach ($sk in @($tree.subkeys)) { if ($sk) { Write-Tree ($path + '\' + [string]$sk.name) $sk.tree } }
}

if ($Mode -eq 'snapshot') {
  $keys = Get-Content -Path $KeysFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $out = @()
  foreach ($k in $keys) {
    $rk = $CU.OpenSubKey([string]$k)
    if (-not $rk) { $out += [pscustomobject]@{ key = [string]$k; exists = $false } }
    else {
      $t = Read-Tree $rk
      $rk.Close()
      $out += [pscustomobject]@{ key = [string]$k; exists = $true; tree = $t }
    }
  }
  $json = $out | ConvertTo-Json -Depth 30
  [System.IO.File]::WriteAllText($File, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output ('SNAPSHOT OK (' + $out.Count + ' keys)')
}
else {
  $raw = Get-Content -Path $File -Raw -Encoding UTF8
  $data = ConvertFrom-Json $raw
  $n = 0
  foreach ($item in $data) {
    $n++
    $CU.DeleteSubKeyTree([string]$item.key, $false)
    if ($item.exists) { Write-Tree ([string]$item.key) $item.tree }
  }
  Write-Output ('RESTORE OK (' + $n + ' keys)')
}
