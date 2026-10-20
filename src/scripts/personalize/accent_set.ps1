# AtomToolBox - apply a Windows accent color the same way Windows Settings does.
# Writes HKCU\Software\Microsoft\Windows\DWM (AccentColor, ColorizationColor) and
# HKCU\...\Explorer\Accent (AccentColorMenu, StartColorMenu, AccentPalette), then
# broadcasts IMMERSIVE_COLOR_SET and restarts Explorer so every surface re-tints
# deterministically. All writes are read back and verified before reporting OK.
# Encodings (confirmed against the machine's stock values):
#   AccentColor/AccentColorMenu/StartColorMenu = 0xAABBGGRR
#   ColorizationColor                          = 0xAARRGGBB (alpha C4)
#   AccentPalette                              = 8 x RGBX (bytes R,G,B,0)
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9A-Fa-f]{6}$')][string]$Color,
  [string]$StartDword = '',
  [switch]$NoRestart
)
$ErrorActionPreference = 'Stop'

$r = [Convert]::ToInt32($Color.Substring(0, 2), 16)
$g = [Convert]::ToInt32($Color.Substring(2, 2), 16)
$b = [Convert]::ToInt32($Color.Substring(4, 2), 16)

$DWM = 'Software\Microsoft\Windows\DWM'
$ACC = 'Software\Microsoft\Windows\CurrentVersion\Explorer\Accent'
$PER = 'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'

function Clamp255([int]$v) { if ($v -lt 0) { return 0 }; if ($v -gt 255) { return 255 }; return $v }

# Palette ladder: light entries lerp toward white (alpha 0.26/0.48/0.70),
# dark entries multiply (0.74/0.545/0.31). Fitted against the stock #0078D7
# palette (A6D8FF/76B9ED/429CE3/0078D7/005A9E/004275/002642) within ~3/255 on
# the mid tones. The 8th slot is machine-specific - it is preserved as-is.
$lights = @(0.70, 0.48, 0.26)
$darks = @(0.74, 0.545, 0.31)
function LerpWhite([int]$v, [double]$a) { return (Clamp255 ([int][Math]::Round($v + (255 - $v) * $a))) }
function MulDark([int]$v, [double]$m) { return (Clamp255 ([int][Math]::Round($v * $m))) }

$palette = New-Object System.Collections.Generic.List[byte]
foreach ($a in $lights) { $palette.Add([byte](LerpWhite $r $a)); $palette.Add([byte](LerpWhite $g $a)); $palette.Add([byte](LerpWhite $b $a)); $palette.Add(0) }
$palette.Add([byte]$r); $palette.Add([byte]$g); $palette.Add([byte]$b); $palette.Add(0)
foreach ($m in $darks) { $palette.Add([byte](MulDark $r $m)); $palette.Add([byte](MulDark $g $m)); $palette.Add([byte](MulDark $b $m)); $palette.Add(0) }
# 8th slot placeholder (machine-specific; replaced from the current key when it exists)
$palette.Add(0); $palette.Add(0); $palette.Add(0); $palette.Add(0)

# The stock Windows blue keeps its native 8th slot; the native blue palette is
# hardcoded for the "default" restore path so it is byte-exact.
$stockBlue = [byte[]](0xA6, 0xD8, 0xFF, 0x00, 0x76, 0xB9, 0xED, 0x00, 0x42, 0x9C, 0xE3, 0x00, 0x00, 0x78, 0xD7, 0x00, 0x00, 0x5A, 0x9E, 0x00, 0x00, 0x42, 0x75, 0x00, 0x00, 0x26, 0x42, 0x00, 0xF7, 0x63, 0x0C, 0x00)
if ($Color -eq '0078D7' -and -not $StartDword) { $paletteBytes = $stockBlue }
else {
  $rl = [byte[]]$palette.ToArray()
  if ($Color -eq '0078D7') { for ($i = 0; $i -lt 28; $i++) { $rl[$i] = $stockBlue[$i] } }
  # preserve the current 8th slot when it exists
  $rkA = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($ACC)
  if ($rkA) { $cur = $rkA.GetValue('AccentPalette', $null); $rkA.Close(); if ($cur -and $cur.Length -ge 32) { for ($i = 28; $i -lt 32; $i++) { $rl[$i] = $cur[$i] } } }
  $paletteBytes = $rl
}

# encoders (signed Int32 is exactly how REG_DWORD stores these; PS 5.1 rejects [uint32] casts)
$accentDword = [int](0xFF000000 -bor ($b -shl 16) -bor ($g -shl 8) -bor $r)      # 0xAABBGGRR
$colorizDword = [int](0xC4000000 -bor ($r -shl 16) -bor ($g -shl 8) -bor $b)     # 0xAARRGGBB
$startDwordVal = $null
if ($StartDword -match '^[0-9A-Fa-f]{8}$') {
  $sv = [Convert]::ToInt64($StartDword, 16)
  if ($sv -gt 0x7FFFFFFF) { $sv = $sv - 0x100000000 }
  $startDwordVal = [int]$sv
}

function SetDwordVerified([string]$sub, [string]$name, [int]$val) {
  $rk = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($sub)
  $rk.SetValue($name, $val, [Microsoft.Win32.RegistryValueKind]::DWord)
  $rk.Close()
  $rk2 = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($sub)
  $back = $rk2.GetValue($name, $null)
  $rk2.Close()
  if ($null -eq $back -or [int]$back -ne $val) { return $false }
  return $true
}
function SetBytesVerified([string]$sub, [string]$name, [byte[]]$bytes) {
  $rk = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($sub)
  $rk.SetValue($name, $bytes, [Microsoft.Win32.RegistryValueKind]::Binary)
  $rk.Close()
  $rk2 = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($sub)
  $back = $rk2.GetValue($name, $null)
  $rk2.Close()
  if (-not $back) { return $false }
  if ($back.Length -ne $bytes.Length) { return $false }
  for ($i = 0; $i -lt $bytes.Length; $i++) { if ($back[$i] -ne $bytes[$i]) { return $false } }
  return $true
}

$ok = $true
if (-not (SetDwordVerified $DWM 'AccentColor' $accentDword)) { $ok = $false; Write-Host '  [!] AccentColor verify failed' }
if (-not (SetDwordVerified $DWM 'ColorizationColor' $colorizDword)) { $ok = $false; Write-Host '  [!] ColorizationColor verify failed' }
if (-not (SetDwordVerified $ACC 'AccentColorMenu' $accentDword)) { $ok = $false; Write-Host '  [!] AccentColorMenu verify failed' }
if ($null -ne $startDwordVal) {
  if (-not (SetDwordVerified $ACC 'StartColorMenu' $startDwordVal)) { $ok = $false; Write-Host '  [!] StartColorMenu verify failed' }
} else {
  if (-not (SetDwordVerified $ACC 'StartColorMenu' $accentDword)) { $ok = $false; Write-Host '  [!] StartColorMenu verify failed' }
}
if (-not (SetBytesVerified $ACC 'AccentPalette' ([byte[]]$paletteBytes))) { $ok = $false; Write-Host '  [!] AccentPalette verify failed' }

if (-not $ok) { Write-Host 'Accent NOT fully applied (see failures above).'; exit 1 }

# tell the shell about the change (live surfaces) - then restart Explorer so
# every surface re-tints deterministically (this is what makes it 100%).
try {
  $sig = '[DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);'
  if (-not ('AtomAccent.Msg' -as [type])) {
    Add-Type -MemberDefinition $sig -Namespace 'AtomAccent' -Name 'Msg'
  }
  $res = [IntPtr]::Zero
  [AtomAccent.Msg]::SendMessageTimeout([IntPtr]0xFFFF, 0x001A, [IntPtr]::Zero, 'ImmersiveColorSet', 2, 2000, [ref]$res) | Out-Null
} catch { Write-Host '  (broadcast skipped)' }

Write-Host ("Accent #" + $Color.ToUpper() + " written and verified (AccentColor=0x{0:X8}, ColorizationColor=0x{1:X8}, palette ok)." -f $accentDword, $colorizDword)

if (-not $NoRestart) {
  Write-Host '  Restarting Explorer to re-tint the taskbar / Start menu...'
  Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 1000
  Start-Process explorer.exe
  Start-Sleep -Seconds 2
  Write-Host '  Explorer restarted.'
}
exit 0
