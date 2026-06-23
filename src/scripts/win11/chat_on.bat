@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows\Windows Chat" /v ChatIcon /t REG_DWORD /d 3 /f
exit /b %errorlevel%