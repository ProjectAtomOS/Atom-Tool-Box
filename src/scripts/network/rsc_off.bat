@echo off
netsh int tcp set global rsc=disabled
exit /b %errorlevel%