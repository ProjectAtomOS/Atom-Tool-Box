@echo off
sc config SecurityHealthService start=auto
sc start SecurityHealthService
exit /b %errorlevel%

