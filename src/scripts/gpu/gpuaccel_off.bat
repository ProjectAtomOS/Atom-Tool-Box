@echo off
reg add "HKCU\Software\Microsoft\Avalon.Graphics" /v DisableHWAcceleration /t REG_DWORD /d 0 /f
exit /b %errorlevel%

