@echo off
powershell -NoProfile -Command "$cs = Get-CimInstance Win32_ComputerSystem; Set-CimInstance -InputObject $cs -Property @{AutomaticManagedPagefile=$false}; $pf = Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue; if (-not $pf) { New-CimInstance -ClassName Win32_PageFileSetting -Property @{Name='C:\pagefile.sys'; InitialSize=0; MaximumSize=0} | Out-Null }"
exit /b %errorlevel%
