@echo off
reg delete "HKLM\Software\Policies\Microsoft\Windows\Windows Search" /v AllowCortana /f
exit /b %errorlevel%
