@echo off
sc config WSearch start=auto
sc start WSearch
exit /b %errorlevel%
