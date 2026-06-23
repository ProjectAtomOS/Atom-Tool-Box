@echo off
reg add "HKLM\System\CurrentControlSet\Services\USBXHCI\Parameters" /v XhciHandoff /t REG_DWORD /d 0 /f
exit /b %errorlevel%
