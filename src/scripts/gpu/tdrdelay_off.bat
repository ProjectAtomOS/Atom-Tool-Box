@echo off
reg add "HKLM\System\CurrentControlSet\Control\GraphicsDrivers" /v TdrDdiDelay /t REG_DWORD /d 8 /f
exit /b %errorlevel%

