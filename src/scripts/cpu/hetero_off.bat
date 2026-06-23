@echo off
reg add "HKLM\System\CurrentControlSet\Control\Session Manager\kernel" /v HeteroScheduling /t REG_DWORD /d 0 /f
exit /b %errorlevel%

