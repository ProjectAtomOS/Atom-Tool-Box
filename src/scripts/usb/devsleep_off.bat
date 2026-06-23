@echo off
reg add "HKLM\System\CurrentControlSet\Services\USBHUB3\Parameters" /v DeviceSleep /t REG_DWORD /d 0 /f
exit /b %errorlevel%

