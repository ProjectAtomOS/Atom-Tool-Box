@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows\GameBar" /v AllowGameBar /t REG_DWORD /d 1 /f
exit /b %errorlevel%