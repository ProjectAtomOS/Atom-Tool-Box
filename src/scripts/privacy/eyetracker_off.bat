@echo off
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\eyeGazeInput" /v Value /t REG_SZ /d Deny /f
exit /b %errorlevel%
