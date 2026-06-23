@echo off
sc config SecurityHealthService start=disabled
sc stop SecurityHealthService
exit /b %errorlevel%

