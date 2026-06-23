@echo off
reg delete "HKLM\System\CurrentControlSet\Control\GraphicsDrivers" /v GlobalFPSLimit /f
exit /b %errorlevel%

