$ErrorActionPreference = 'SilentlyContinue'
$cu = [Microsoft.Win32.Registry]::CurrentUser

Write-Host '=== accents (pristine blue expected) ==='
$dwm = $cu.OpenSubKey('Software\Microsoft\Windows\DWM')
Write-Host ('DWM AccentColor        = 0x{0:X8}' -f $dwm.GetValue('AccentColor'))
Write-Host ('DWM ColorizationColor  = 0x{0:X8}' -f $dwm.GetValue('ColorizationColor'))
$dwm.Close()
$acc = $cu.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Explorer\Accent')
Write-Host ('AccentColorMenu        = 0x{0:X8}' -f $acc.GetValue('AccentColorMenu'))
Write-Host ('StartColorMenu         = 0x{0:X8}' -f $acc.GetValue('StartColorMenu'))
$pal = $acc.GetValue('AccentPalette')
if ($pal) { Write-Host ('AccentPalette          = ' + (($pal | ForEach-Object { $_.ToString('x2') }) -join '')) }
$acc.Close()

Write-Host '=== personalization key ==='
$p = $cu.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Themes\Personalize')
Write-Host ('ColorPrevalence        = ' + $p.GetValue('ColorPrevalence'))
$p.Close()

Write-Host '=== junk key scan (quote-named) ==='
$anyLeft = $false
foreach ($path in @('Software\Microsoft\Windows\CurrentVersion\Themes','Software\Microsoft\Windows','Software\Microsoft\Windows\CurrentVersion','Software\Microsoft\Windows\CurrentVersion\Explorer','Software\Microsoft\Windows\CurrentVersion\Explorer\HideDesktopIcons')) {
  $k = $cu.OpenSubKey($path)
  if ($k) { foreach ($sn in $k.GetSubKeyNames()) { if ($sn.Contains('"')) { Write-Host ('JUNK ' + $path + ' : ' + $sn); $anyLeft = $true } }; $k.Close() }
}
if (-not $anyLeft) { Write-Host 'none' }

Write-Host '=== desktop icons key ==='
$hd = $cu.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Explorer\HideDesktopIcons\NewStartPanel')
if ($hd) { Write-Host ('values: ' + $hd.GetValueNames().Count); $hd.Close() } else { Write-Host 'key absent' }

Write-Host '=== take ownership keys (working entries left present) ==='
$to1 = $cu.OpenSubKey('Software\Classes\*\shell\TakeOwnership')
if ($to1) { Write-Host ('file variant cmd: ' + $to1.GetValue('')) ; $to1.Close() } else { Write-Host 'file variant ABSENT' }
$to2 = $cu.OpenSubKey('Software\Classes\Directory\shell\TakeOwnership')
if ($to2) { Write-Host ('dir variant cmd:  ' + $to2.GetValue('')) ; $to2.Close() } else { Write-Host 'dir variant ABSENT' }

Write-Host '=== power plans ==='
powercfg /list

Write-Host '=== electron processes ==='
$e = Get-Process electron -ErrorAction SilentlyContinue
if ($e) { Write-Host ('electron running: ' + $e.Count) } else { Write-Host 'no electron running' }
Write-Host '=== done ==='
