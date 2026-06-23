@echo off
reg add "HKLM\System\CurrentControlSet\Services\USBHUB3\Parameters" /v MaxTransferSize /t REG_DWORD /d 1048576 /f
exit /b %errorlevel%

