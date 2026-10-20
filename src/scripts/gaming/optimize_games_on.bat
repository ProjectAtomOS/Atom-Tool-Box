@echo off
bcdedit /set disabledynamictick yes
exit /b %errorlevel%
