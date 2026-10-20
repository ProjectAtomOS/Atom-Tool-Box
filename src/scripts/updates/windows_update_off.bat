@echo off
sc config wuauserv start= demand
if errorlevel 1 exit /b 1
sc start wuauserv >nul 2>&1
exit /b 0
