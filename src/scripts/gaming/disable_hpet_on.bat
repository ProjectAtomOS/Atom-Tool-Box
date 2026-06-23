@echo off
bcdedit /set useplatformclock false
bcdedit /set disabledynamictick yes
exit /b %errorlevel%