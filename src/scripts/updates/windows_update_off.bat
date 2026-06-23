@echo off
sc config wuauserv start= demand
sc start wuauserv
exit /b %errorlevel%