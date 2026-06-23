@echo off
reg add "HKLM\Software\Policies\Microsoft\WindowsStore" /v AutoDownload /t REG_DWORD /d 0 /f
exit /b %errorlevel%

