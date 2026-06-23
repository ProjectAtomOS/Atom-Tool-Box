@echo off
netsh int tcp set global heuristics=enabled
exit /b %errorlevel%