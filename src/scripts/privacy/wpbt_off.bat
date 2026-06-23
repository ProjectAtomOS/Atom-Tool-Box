@echo off
reg add "HKLM\System\CurrentControlSet\Control\Session Manager" /v DisableWpbtExecution /t REG_DWORD /d 1 /f
exit /b %errorlevel%