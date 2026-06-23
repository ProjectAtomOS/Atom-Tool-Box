@echo off
reg add "HKLM\System\CurrentControlSet\Services\USB\Parameters" /v DisableSelectiveSuspend /t REG_DWORD /d 0 /f
exit /b %errorlevel%

