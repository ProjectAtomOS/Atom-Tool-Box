@echo off
sc config WaaSMedicSvc start= disabled
exit /b %errorlevel%