param(
  [string]$ShortcutPath = (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\AtomToolBox.lnk'),
  [switch]$Force
)

# Pins AtomToolBox to the current user's taskbar using the Windows taskbar
# layout (append-only). Microsoft removed the old Shell.Application
# "taskbarpin" verb after Windows 10 21H2, so the layout is the only reliable
# non-invasive method left. PinListPlacement is deliberately omitted: that
# appends AtomToolBox and preserves every existing taskbar pin.
#
# The layout is read when Explorer starts. We write it, restart Explorer once,
# wait for the pin to appear, then remove the XML so the pin becomes a normal
# user pin and is not re-applied on every logon.

$ErrorActionPreference = 'Stop'
$script:logPath = Join-Path $env:TEMP 'atom-pin-taskbar.log'
$script:xmlPath = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Shell\LayoutModification.xml'
$script:pinPath = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\AtomToolBox.lnk'
$script:createdXml = $false

function Write-Result([int]$code, [string]$message) {
  if ($script:createdXml -and (Test-Path $script:xmlPath)) {
    Remove-Item $script:xmlPath -Force -ErrorAction SilentlyContinue
    $script:createdXml = $false
  }
  $message | Set-Content -Path $script:logPath -Encoding UTF8
  Write-Output $message
  exit $code
}

try {
  if ((Test-Path $script:pinPath) -and (-not $Force)) {
    Write-Result 0 'OK already pinned'
  }

  if (-not (Test-Path $ShortcutPath)) {
    Write-Result 3 ('SKIP shortcut missing: ' + $ShortcutPath)
  }

  # Never overwrite an existing user/enterprise layout.
  if (Test-Path $script:xmlPath) {
    Write-Result 2 'SKIP existing user LayoutModification.xml'
  }

  $autoRestart = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name AutoRestartShell -ErrorAction SilentlyContinue).AutoRestartShell
  if ($null -eq $autoRestart) { $autoRestart = 1 }
  if ($autoRestart -eq 0) {
    Write-Result 4 'SKIP Explorer auto-restart is disabled'
  }

  $escaped = $ShortcutPath.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
  $xml = @"
<?xml version="1.0" encoding="utf-8"?>
<LayoutModificationTemplate
  xmlns="http://schemas.microsoft.com/Start/2014/LayoutModification"
  xmlns:defaultlayout="http://schemas.microsoft.com/Start/2014/FullDefaultLayout"
  xmlns:taskbar="http://schemas.microsoft.com/Start/2014/TaskbarLayout"
  Version="1">
  <CustomTaskbarLayoutCollection>
    <defaultlayout:TaskbarLayout>
      <taskbar:TaskbarPinList>
        <taskbar:DesktopApp DesktopApplicationLinkPath="$escaped"/>
      </taskbar:TaskbarPinList>
    </defaultlayout:TaskbarLayout>
  </CustomTaskbarLayoutCollection>
</LayoutModificationTemplate>
"@

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $script:xmlPath) | Out-Null
  Set-Content -Path $script:xmlPath -Value $xml -Encoding UTF8
  $script:createdXml = $true

  Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
  $restarted = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Get-Process explorer -ErrorAction SilentlyContinue) {
      $restarted = $true
      break
    }
  }
  if (-not $restarted) {
    # Last resort: restore the shell if Windows did not auto-restart it.
    Start-Process explorer.exe
    Start-Sleep -Seconds 3
  }

  $pinned = $false
  for ($i = 0; $i -lt 20; $i++) {
    if (Test-Path $script:pinPath) {
      $pinned = $true
      break
    }
    Start-Sleep -Seconds 1
  }

  if ($pinned) {
    Write-Result 0 'OK pinned'
  } else {
    Write-Result 5 'FAIL pin did not appear'
  }
} catch {
  Write-Result 1 ('ERROR ' + $_.Exception.Message)
} finally {
  if ($script:createdXml -and (Test-Path $script:xmlPath)) {
    Remove-Item $script:xmlPath -Force -ErrorAction SilentlyContinue
  }
}
