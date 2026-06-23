@echo off
bcdedit /set useplatformclock false
exit /b %errorlevel%