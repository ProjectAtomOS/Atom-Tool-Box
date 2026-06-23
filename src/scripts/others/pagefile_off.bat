@echo off
wmic computersystem where name="%COMPUTERNAME%" set AutomaticManagedPagefile=False
wmic pagefileset delete
exit /b %errorlevel%

