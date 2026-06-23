@echo off
netsh interface teredo set state disabled
exit /b %errorlevel%