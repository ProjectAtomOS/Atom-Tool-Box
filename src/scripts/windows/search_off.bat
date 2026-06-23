@echo off
sc config WSearch start=disabled
sc stop WSearch
exit /b %errorlevel%
