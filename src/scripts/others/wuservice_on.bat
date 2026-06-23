@echo off
sc config wuauserv start=auto
sc start wuauserv
exit /b %errorlevel%

