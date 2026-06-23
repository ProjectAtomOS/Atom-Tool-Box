@echo off
netsh interface teredo set state default
exit /b %errorlevel%