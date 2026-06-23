@echo off
netsh advfirewall set allprofiles state on
exit /b %errorlevel%

