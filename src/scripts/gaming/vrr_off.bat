@echo off
reg add "HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers" /v VariableRefreshRate /t REG_DWORD /d 0 /f
exit /b %errorlevel%