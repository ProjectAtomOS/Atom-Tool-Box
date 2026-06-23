@echo off
netsh int tcp set global autotuninglevel=normal
exit /b %errorlevel%