@echo off
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\graphicsCaptureWithoutBorder" /v Value /t REG_SZ /d Allow /f
exit /b %errorlevel%
