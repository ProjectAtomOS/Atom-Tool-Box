@echo off
bcdedit /set disabledynamictick no
exit /b %errorlevel%
