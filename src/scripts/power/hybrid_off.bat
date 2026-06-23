@echo off
powercfg -h off
powercfg /change hybrid-sleep-ac 0
exit /b %errorlevel%

