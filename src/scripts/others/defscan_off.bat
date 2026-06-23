@echo off
reg add "HKLM\Software\Microsoft\Windows Defender\Scan" /v DisableScheduledScanning /t REG_DWORD /d 1 /f
exit /b %errorlevel%

