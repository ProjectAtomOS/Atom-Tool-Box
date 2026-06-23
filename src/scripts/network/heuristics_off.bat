@echo off
netsh int tcp set global heuristics=disabled
exit /b %errorlevel%