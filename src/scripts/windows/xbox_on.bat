@echo off
sc config XboxGipSvc start=auto
sc config XblAuthManager start=auto
sc config XboxNetApiSvc start=auto
exit /b %errorlevel%
