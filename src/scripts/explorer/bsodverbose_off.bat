@echo off
reg add "HKLM\System\CurrentControlSet\Control\CrashControl" /v DisplayParameters /t REG_DWORD /d 0 /f
exit /b %errorlevel%