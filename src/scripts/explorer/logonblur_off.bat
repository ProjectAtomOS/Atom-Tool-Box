@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows\System" /v DisableAcrylicBackgroundOnLogon /t REG_DWORD /d 1 /f
exit /b %errorlevel%