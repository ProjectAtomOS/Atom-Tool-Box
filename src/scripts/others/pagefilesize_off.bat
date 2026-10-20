@echo off
powershell -NoProfile -Command "$cs = Get-CimInstance Win32_ComputerSystem; Set-CimInstance -InputObject $cs -Property @{AutomaticManagedPagefile=$false}; $pf = Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue; if ($pf) { Set-CimInstance -InputObject $pf -Property @{InitialSize=8192; MaximumSize=8192} } else { New-CimInstance -ClassName Win32_PageFileSetting -Property @{Name='C:\pagefile.sys'; InitialSize=8192; MaximumSize=8192} | Out-Null }"
exit /b %errorlevel%
