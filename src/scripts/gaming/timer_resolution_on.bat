@echo off
bcdedit /set useplatformtick yes
bcdedit /set disabledynamictick yes
exit /b %errorlevel%