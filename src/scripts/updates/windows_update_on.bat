@echo off
sc config wuauserv start= disabled
sc stop wuauserv
exit /b %errorlevel%