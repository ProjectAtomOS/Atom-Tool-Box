@echo off
netsh advfirewall set allprofiles state off
exit /b %errorlevel%

