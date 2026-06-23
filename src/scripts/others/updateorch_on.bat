@echo off
sc config UsoSvc start=auto
sc start UsoSvc
exit /b %errorlevel%

