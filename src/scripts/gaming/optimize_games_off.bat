@echo off
bcdedit /set useplatformclock true
exit /b %errorlevel%