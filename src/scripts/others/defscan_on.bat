@echo off
reg add "HKLM\Software\Microsoft\Windows Defender\Scan" /v DisableScheduledScanning /t REG_DWORD /d 0 /f
exit /b %errorlevel%

