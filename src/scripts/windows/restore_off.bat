@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows NT\SystemRestore" /v DisableSR /t REG_DWORD /d 1 /f
exit /b %errorlevel%

