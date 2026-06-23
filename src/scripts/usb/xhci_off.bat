@echo off
reg add "HKLM\System\CurrentControlSet\Services\USBXHCI\Parameters" /v XhciHandoff /t REG_DWORD /d 1 /f
exit /b %errorlevel%

