@echo off
powercfg -h on
powercfg /change hybrid-sleep-ac 1
exit /b %errorlevel%

