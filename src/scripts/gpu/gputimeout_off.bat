@echo off
reg add "HKLM\System\CurrentControlSet\Control\GraphicsDrivers" /v TdrDelay /t REG_DWORD /d 8 /f
exit /b %errorlevel%

