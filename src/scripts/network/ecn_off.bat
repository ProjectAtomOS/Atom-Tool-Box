@echo off
netsh int tcp set global ecncapability=disabled
exit /b %errorlevel%