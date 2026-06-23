@echo off
sc config UsoSvc start=disabled
sc stop UsoSvc
exit /b %errorlevel%

