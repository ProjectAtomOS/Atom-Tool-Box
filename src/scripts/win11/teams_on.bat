@echo off
powershell -NoProfile -Command "Get-AppxPackage *Teams* | Remove-AppxPackage"
exit /b %errorlevel%