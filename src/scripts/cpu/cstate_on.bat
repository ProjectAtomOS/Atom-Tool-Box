@echo off
powercfg -setacvalueindex 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c SUB_PROCESSOR CPMINCORES 0
powercfg -setacvalueindex 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c SUB_PROCESSOR CPMAXCORES 100
exit /b %errorlevel%
