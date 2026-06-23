@echo off
reg add "HKLM\System\CurrentControlSet\Control\GraphicsDrivers" /v MemoryThrottling /t REG_DWORD /d 1 /f
exit /b %errorlevel%

