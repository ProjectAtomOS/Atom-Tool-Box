@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows\System" /v DisableAcrylicBackgroundOnLogon /t REG_DWORD /d 0 /f
exit /b %errorlevel%