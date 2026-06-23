@echo off
wmic computersystem where name="%COMPUTERNAME%" set AutomaticManagedPagefile=False
wmic pagefileset create name="C:\\pagefile.sys" InitialSize=8192 MaximumSize=8192
exit /b %errorlevel%

