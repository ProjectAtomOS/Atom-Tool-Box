@echo off
reg add "HKLM\System\CurrentControlSet\Services\USB\Parameters" /v DisableSelectiveSuspend /t REG_DWORD /d 1 /f
exit /b %errorlevel%

