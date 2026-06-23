@echo off
powershell -NoProfile -Command "Get-AppxPackage *xbox* | Remove-AppxPackage; Get-AppxPackage *gaming* | Remove-AppxPackage"
sc config XboxGipSvc start=disabled
sc config XblAuthManager start=disabled
sc config XblGameSave start=disabled
sc config XboxNetApiSvc start=disabled
exit /b %errorlevel%