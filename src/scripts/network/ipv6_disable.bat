@echo off
reg add "HKLM\System\CurrentControlSet\Services\Tcpip6\Parameters" /v DisabledComponents /t REG_DWORD /d 0xff /f
exit /b %errorlevel%