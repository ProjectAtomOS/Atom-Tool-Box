@echo off
netsh int tcp set global rss=disabled
exit /b %errorlevel%