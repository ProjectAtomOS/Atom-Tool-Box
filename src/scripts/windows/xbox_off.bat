@echo off
sc config XboxGipSvc start=disabled
sc config XblAuthManager start=disabled
sc config XboxNetApiSvc start=disabled
sc stop XboxGipSvc
sc stop XblAuthManager
sc stop XboxNetApiSvc
exit /b %errorlevel%
