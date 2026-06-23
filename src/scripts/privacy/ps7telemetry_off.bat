@echo off
reg add "HKLM\Software\Policies\Microsoft\PowerShellCore" /v EnableTelemetry /t REG_DWORD /d 0 /f
exit /b %errorlevel%