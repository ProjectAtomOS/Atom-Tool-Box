@echo off
reg add "HKLM\System\CurrentControlSet\Control\Session Manager\Memory Management" /v ClearPageFileAtShutdown /t REG_DWORD /d 1 /f
exit /b %errorlevel%

