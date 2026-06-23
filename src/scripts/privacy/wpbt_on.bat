@echo off
reg delete "HKLM\System\CurrentControlSet\Control\Session Manager" /v DisableWpbtExecution /f
exit /b %errorlevel%