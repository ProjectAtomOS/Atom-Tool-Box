@echo off
rem Marks Ethernet/WiFi as metered by default (HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\DefaultMediaCost).
rem The key is TrustedInstaller-owned: metered_lock.ps1 performs the take-ownership dance and restores the ACL afterwards.
rem %CD% = app base dir (rewritten by the engine so the temp-copied bat still finds its helper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\src\scripts\updates\metered_lock.ps1" 2
exit /b %errorlevel%
