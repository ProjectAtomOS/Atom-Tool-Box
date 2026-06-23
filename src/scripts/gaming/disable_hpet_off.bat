@echo off
bcdedit /set useplatformclock true
bcdedit /set disabledynamictick no
exit /b %errorlevel%