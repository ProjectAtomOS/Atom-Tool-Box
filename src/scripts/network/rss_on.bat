@echo off
netsh int tcp set global rss=enabled
exit /b %errorlevel%