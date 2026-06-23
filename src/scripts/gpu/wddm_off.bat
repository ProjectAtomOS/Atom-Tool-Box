@echo off
reg add "HKLM\System\CurrentControlSet\Control\GraphicsDrivers" /v PlatformOptimization /t REG_DWORD /d 1 /f
exit /b %errorlevel%

