@echo off
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v RestoreOnStartup /t REG_DWORD /d 5 /f
exit /b %errorlevel%
