@echo off
netsh int tcp set global timestamps=disabled
exit /b %errorlevel%