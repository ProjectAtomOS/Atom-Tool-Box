@echo off
reg add "HKLM\System\CurrentControlSet\Control\Power\PowerSettings\54533251-82be-4824-96c1-47b60b740d00" /v Value /t REG_DWORD /d 0 /f
exit /b %errorlevel%

