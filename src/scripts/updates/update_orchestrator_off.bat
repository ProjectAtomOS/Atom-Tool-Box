@echo off
sc config UsoSvc start= demand
exit /b %errorlevel%