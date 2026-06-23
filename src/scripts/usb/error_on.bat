@echo off
reg add "HKLM\System\CurrentControlSet\Services\USBHUB3\Parameters" /v ErrorReporting /t REG_DWORD /d 1 /f
exit /b %errorlevel%

