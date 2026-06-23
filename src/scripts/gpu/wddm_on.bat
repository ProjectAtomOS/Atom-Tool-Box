@echo off
reg add "HKLM\System\CurrentControlSet\Control\GraphicsDrivers" /v PlatformOptimization /t REG_DWORD /d 0 /f
exit /b %errorlevel%

