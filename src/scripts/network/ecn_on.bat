@echo off
netsh int tcp set global ecncapability=enabled
exit /b %errorlevel%