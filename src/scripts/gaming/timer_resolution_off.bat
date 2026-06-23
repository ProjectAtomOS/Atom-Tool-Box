@echo off
bcdedit /set useplatformtick no
bcdedit /set disabledynamictick no
exit /b %errorlevel%