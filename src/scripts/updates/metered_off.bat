@echo off
rem Restores the default metered state (Ethernet/WiFi = not metered) in HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\DefaultMediaCost.
rem The key is TrustedInstaller-owned: metered_lock.ps1 performs the take-ownership dance and restores the ACL afterwards.
rem %CD% = app base dir (rewritten by the engine so the temp-copied bat still finds its helper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\src\scripts\updates\metered_lock.ps1" 1
exit /b %errorlevel%
