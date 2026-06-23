@echo off
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer" /v ShowBatteryPercentage /t REG_DWORD /d 1 /f
exit /b %errorlevel%