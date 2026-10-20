@echo off
sc config wuauserv start= disabled
if errorlevel 1 exit /b 1
sc stop wuauserv >nul 2>&1
exit /b 0
