@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows NT\SystemRestore" /v DisableSR /t REG_DWORD /d 0 /f
exit /b %errorlevel%

