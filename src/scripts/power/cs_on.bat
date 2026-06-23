@echo off
reg add "HKLM\System\CurrentControlSet\Control\Power" /v CsEnabled /t REG_DWORD /d 1 /f
exit /b %errorlevel%

