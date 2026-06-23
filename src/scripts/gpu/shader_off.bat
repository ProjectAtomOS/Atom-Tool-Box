@echo off
reg add "HKLM\System\CurrentControlSet\Control\GraphicsDrivers" /v ShaderCache /t REG_DWORD /d 1 /f
exit /b %errorlevel%

