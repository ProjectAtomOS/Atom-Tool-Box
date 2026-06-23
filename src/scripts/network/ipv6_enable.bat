@echo off
reg add "HKLM\System\CurrentControlSet\Services\Tcpip6\Parameters" /v DisabledComponents /t REG_DWORD /d 0x0 /f
exit /b %errorlevel%