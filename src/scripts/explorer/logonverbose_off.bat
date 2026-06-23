@echo off
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v VerboseStatus /t REG_DWORD /d 0 /f
exit /b %errorlevel%