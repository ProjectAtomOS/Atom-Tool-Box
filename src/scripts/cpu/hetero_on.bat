@echo off
reg delete "HKLM\System\CurrentControlSet\Control\Session Manager\kernel" /v HeteroScheduling /f
exit /b %errorlevel%

