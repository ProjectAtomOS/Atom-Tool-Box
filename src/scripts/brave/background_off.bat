@echo off
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v BackgroundModeEnabled /t REG_DWORD /d 0 /f
exit /b %errorlevel%
