@echo off
netsh int tcp set global timestamps=enabled
exit /b %errorlevel%