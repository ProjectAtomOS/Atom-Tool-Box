@echo off
netsh int tcp set global rsc=enabled
exit /b %errorlevel%