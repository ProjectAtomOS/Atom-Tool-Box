@echo off
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v MetricsReportingEnabled /t REG_DWORD /d 0 /f
exit /b %errorlevel%
