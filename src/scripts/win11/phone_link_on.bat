@echo off
powershell -NoProfile -Command "Get-AppxPackage *YourPhone* | Remove-AppxPackage"
exit /b %errorlevel%