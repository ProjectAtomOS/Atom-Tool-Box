@echo off
powershell -NoProfile -Command "Get-AppxPackage *DevHome* | Remove-AppxPackage"
exit /b %errorlevel%