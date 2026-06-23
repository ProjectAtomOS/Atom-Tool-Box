@echo off
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\ReserveManager" /v ShippedWithReserves /t REG_DWORD /d 1 /f
exit /b %errorlevel%

