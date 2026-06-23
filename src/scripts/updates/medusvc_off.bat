@echo off
sc config WaaSMedicSvc start= demand
exit /b %errorlevel%