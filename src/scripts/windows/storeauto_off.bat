@echo off
reg add "HKLM\Software\Policies\Microsoft\WindowsStore" /v AutoDownload /t REG_DWORD /d 2 /f
exit /b %errorlevel%

