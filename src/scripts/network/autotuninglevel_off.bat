@echo off
netsh int tcp set global autotuninglevel=disabled
exit /b %errorlevel%