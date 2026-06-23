@echo off
reg add "HKLM\System\CurrentControlSet\Control\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d 2 /f
exit /b %errorlevel%
