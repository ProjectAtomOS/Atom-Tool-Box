@echo off
reg add "HKLM\System\CurrentControlSet\Services\USBHUB3\Parameters" /v IdleLatency /t REG_DWORD /d 0 /f
exit /b %errorlevel%

