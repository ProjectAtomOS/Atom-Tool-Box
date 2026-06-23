@echo off
reg add "HKLM\System\CurrentControlSet\Control\PriorityControl" /v IRQ8Priority /t REG_DWORD /d 1 /f
exit /b %errorlevel%

