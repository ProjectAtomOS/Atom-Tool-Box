@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows\Windows Chat" /v ChatIcon /t REG_DWORD /d 1 /f
exit /b %errorlevel%