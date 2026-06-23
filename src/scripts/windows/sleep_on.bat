@echo off
powercfg /change standby-timeout-ac 30
powercfg /change hibernate-timeout-ac 60
exit /b %errorlevel%
