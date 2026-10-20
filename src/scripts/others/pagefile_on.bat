@echo off
powershell -NoProfile -Command "$cs = Get-CimInstance Win32_ComputerSystem; Set-CimInstance -InputObject $cs -Property @{AutomaticManagedPagefile=$true}"
exit /b %errorlevel%
