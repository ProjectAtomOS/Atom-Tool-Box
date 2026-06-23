@echo off
sc config UsoSvc start= disabled
exit /b %errorlevel%