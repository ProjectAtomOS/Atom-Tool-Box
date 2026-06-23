@echo off
reg delete "HKLM\Software\Policies\Microsoft\Edge\URLBlocklist" /f
exit /b %errorlevel%