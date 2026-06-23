@echo off
wmic computersystem where name="%COMPUTERNAME%" set AutomaticManagedPagefile=True
exit /b %errorlevel%

