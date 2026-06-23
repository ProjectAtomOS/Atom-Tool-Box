@echo off
reg add "HKLM\System\CurrentControlSet\Control\PriorityControl" /v Win32PrioritySeparation /t REG_DWORD /d 38 /f
exit /b %errorlevel%
